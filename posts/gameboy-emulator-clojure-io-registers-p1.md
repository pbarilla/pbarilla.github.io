# I/O Registers - Part 1

## Not to be confused with the CPU Registers

Unlike the registers we discussed in [Part 1](./post.html?id=gameboy-emulator-clojure), I/O registers arent part of the CPU. They're physical parts of the Gameboy hardware, that then map to memory locations, starting at 0xFF00.

## So how many are there?

Theres heaps. Like, way too many to go into detail here. So instead of doing that, we're going to focus on the minimum required to get the gameboy to boot. This means we wont focus on sound just yet.

## The minimum I/O Registers

The minimum I/O Registers we need to get the gameboy to boot are:

- `P1` - Joypad
- `DIV` - Divider Register
- `TIMA` - Timer Counter
- `TMA` - Timer Modulo
- `TAC` - Timer Control
- `IF` - Interrupt Flag
- `LCDC` - LCD Control
- `STAT` - LCD Status
- `SCY` - Scroll Y
- `SCX` - Scroll X
- `LY` - LCD Y Coordinate
- `LYC` - LY Compare
- `DMA` - DMA Transfer and Start Address
- `BGP` - BG Palette Data
- `OBP0` - Object Palette 0 Data
- `OBP1` - Object Palette 1 Data
- `WY` - Window Y Position
- `WX` - Window X Position
- `IE` - Interrupt Enable

As we go through this series, we'll eventually impliment each of these. But we'll start with the Joypad. That's at memory location 0xFF00. Just one byte.

But how can 1 byte handle all 8 inputs? (Up down left right A B Select Start)?

There are 6 wires, or buttons, or connections. Things. Things on the Gameboy hardware. They're refered to as P10 -> P15. They cross over each other to form a matrix.

![The matrix layout of the Joypad](/images/joypad-matrix-layout.png)

P10 -> P13 are considered 'Input' wires. They're connected to the buttons on the Joypad.

P14 and P15 are considered 'Select' or 'Output' wires. They're able to test if the input wires are being pulled low or high. If they're low, it means the button is pressed. If they're high, it means the button is not pressed.

Okay this took me a bit of time to understand the first time. Here's how it works:

`P14` is used to poll the direction keys, and `P15` is used to poll the action keys.

| Bit   | Use                   |
| ----- | --------------------- |
| Bit 7 | Not used              |
| Bit 6 | Not used              |
| Bit 5 | Select Button Keys    |
| Bit 4 | Select Direction Keys |
| Bit 3 | Input Down or Start   |
| Bit 2 | Input Up or Select    |
| Bit 1 | Input Left or B       |
| Bit 0 | Input Right or A      |

When we wanna check if a button is pressed, we first need to set either bit 4 or bit 5 to `low` (0). We make sure the other bit is `high` (1).

We then read the values of Bits 0 - 3, and if the value is `0`, that means the button is pressed. It's because theres a current running through those wires, and pressing the button `breaks` that signal.

This also means that the Gameboy can only poll for either action or direction keys per frame, but not both. So special care is needed to ensure that when games check for input, the check both sets of buttons.

Games are responsible for handling this, but we (as the emulator developers) are responsible for making sure the input is handled correctly.

Let's start by creating a `joypad.clj` file.

```clojure
;; joypad.clj
(ns clojure-boy.joypad
  (:import (javax.swing JComponent KeyStroke AbstractAction)))

; If the user hasnt remapped the buttons, use this default
(def default-button-map {:up "UP" :down "DOWN" :left "LEFT" :right "RIGHT" :a "A" :b "S" :select "Z" :start "X"})
(def button-map (atom default-button-map))

; The current state of the buttons
(def button-state (atom {:up false :down false :left false :right false :a false :b false :select false :start false}))

(defn setup-input [window-components]
  (let [root-pane (.getRootPane (:frame window-components))
        input-map (.getInputMap root-pane JComponent/WHEN_IN_FOCUSED_WINDOW)
        action-map (.getActionMap root-pane)]

    ;; Setup each button in the map
    (doseq [[button key] @button-map]
      (let [press-action (proxy [AbstractAction] []
                           (actionPerformed [e]
                             (swap! button-state assoc button true)))
            release-action (proxy [AbstractAction] []
                             (actionPerformed [e]
                               (swap! button-state assoc button false)))
            press-key (str key)
            release-key (str "released " key)]

        ;; Bind both press and release for each button
        (.put input-map (KeyStroke/getKeyStroke press-key) (str button "-press"))
        (.put input-map (KeyStroke/getKeyStroke release-key) (str button "-release"))
        (.put action-map (str button "-press") press-action)
        (.put action-map (str button "-release") release-action)))))

;; If the user wants to remap a button
(defn remap-button [button new-key]
  (swap! button-map assoc button new-key))

```

And then in `core.clj` we'll need to add the following:

```clojure

;; ... at the top, where the other defs are ...
(def window-components (display/create-window))
(joypad/setup-input window-components)

;; ... in the main function, in render-future, update the #do block to include the button state in the debug
(display/update-display window-components
                        (checkerboard-frame)
                        {"rom-size" (:rom-size @system-cartridge)
                         "cart-type" (:cart-type @system-cartridge)
                         "banks-loaded" (:banks-loaded @system-cartridge)
                         "frame-counter" @frame-counter
                         "a" (:a @joypad/button-state)
                         "b" (:b @joypad/button-state)
                         "start" (:start @joypad/button-state)
                         "select" (:select @joypad/button-state)
                         "up" (:up @joypad/button-state)
                         "down" (:down @joypad/button-state)
                         "left" (:left @joypad/button-state)
                         "right" (:right @joypad/button-state)})

```

And then just run it as normal, which is:

```bash
lein run some_rom.gb
```

![We have input!](/images/joypad-test-1.gif)

So we have some input, but we need to now add it to the register at 0xFF00. To do this, we need to create a function in `joypad.clj` that will handle a test request.

For now, we'll just do a simple test by passing in a byte with either `2r11011111` or `2r11101111`.

| P   | Bit | Binary     |
| --- | --- | ---------- |
| P14 | 4   | 2r11101111 |
| P15 | 5   | 2r11011111 |

> Remember, the one we're testing is OFF, not ON.

```clojure
;; ... in joypad.clj, at the bottom ...
(defn test-input [p1byte]
;; First make sure that lower bits are set
  (let [byte (-> p1byte
                 (bit-set 0)
                 (bit-set 1)
                 (bit-set 2)
                 (bit-set 3))]

    (cond-> byte
    ;; If P15 is off, we're testing the action keys. Clear each bit corresponding to a button that's pressed.
      (not (bit-test byte 5)) (as-> byte
                                    (cond-> byte
                                      (:start @button-state)  (bit-clear 3)
                                      (:select @button-state) (bit-clear 2)
                                      (:a @button-state)      (bit-clear 0)
                                      (:b @button-state)      (bit-clear 1)))

    ;; If P14 is off, we're testing the direction keys. Clear each bit corresponding to a direction that's pressed.
      (not (bit-test byte 4)) (as-> byte
                                    (cond-> byte
                                      (:up @button-state)    (bit-clear 2)
                                      (:down @button-state)  (bit-clear 3)
                                      (:left @button-state)  (bit-clear 1)
                                      (:right @button-state) (bit-clear 0))))))
```

Now we need to add this to our debug window.

```clojure
;; ... in core.clj, in render-future, update the #do block to include the button state in the debug
(display/update-display window-components
                        (checkerboard-frame)
                        (let [p15-result (joypad/test-input 2r11011111) ; Bit 5 is 0
                                p14-result (joypad/test-input 2r11101111)] ; Bit 4 is 0
                            {"rom-size"     (:rom-size @system-cartridge)
                            "cart-type"    (:cart-type @system-cartridge)
                            "banks-loaded" (:banks-loaded @system-cartridge)
                            "frame-counter" @frame-counter
                            "a"      (:a @joypad/button-state)
                            "b"      (:b @joypad/button-state)
                            "start"  (:start @joypad/button-state)
                            "select" (:select @joypad/button-state)
                            "up"     (:up @joypad/button-state)
                            "down"   (:down @joypad/button-state)
                            "left"   (:left @joypad/button-state)
                            "right"  (:right @joypad/button-state)
                            "p15"    (string/replace (format "%8s" (Integer/toBinaryString p15-result)) " " "0")
                            "p14"    (string/replace (format "%8s" (Integer/toBinaryString p14-result)) " " "0")}))
```

Notice how the p15 and p14 results are changing based on which button is pressed? This is what we'd end up writing into 0xFF00 depending on if bit 4 or 5 was OFF.

![We have the IO Register done!](/images/joypad-test-2.gif)
