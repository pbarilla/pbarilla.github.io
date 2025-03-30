# I/O Registers - Part 2

Theres a ton of other registers we need to build before we can power on the Gameboy. Let's get to work!

## DIV

`DIV` (0xFF04) is a divider register. It's a 8 bit register that counts the number of clock cycles since the last `DIV` write. It increments by 16384 every second. Writing to it resets it to 0.

The easiest way to do this is to just write 274 to it each frame. That'll roughly hit the 16384 mark each second. Close enough for now. That'll also mean we dont need to listen to the 'write' events, because we'll make sure the write events set it to 0x00, and start the count all over again.

This value _will_ overflow. And hang on, 274 is a bigger number than 8 bits. So how does this even work?

Well, DIV is actually the upper 8 bits of an internal 16 bit register. That increases at `4,194,304 hz`, which is the Gameboys CPU speed.

So for our emulator, we actually need to track the full 16 bit counter, and then pass the upper 8 bits to the DIV register.

Let's make a new namespace for this, and all the other I/O registers.

```clojure
(ns clojure-boy.ioreg)

(def div-clock-full (atom 0))
(def div-clock-register (atom 0))

; This will get called every frame, and handle any increments, etc, that are needed every frame.
; Eventually we can pass in state, etc, and have this handle more complex operations.
(defn processFrame []
  (swap! div-clock-full + 70256)
  (when (> @div-clock-full 0xFFFF)  ; Check against 16-bit overflow
    (swap! div-clock-full #(- % 0x10000))  ; Subtract full 16-bit value
    (swap! div-clock-register inc))  ; Increment the register
  (swap! div-clock-register #(bit-and % 0xFF)))  ; Keep it 8-bit

; This should be used to write to 0xFF04 every frame
(defn get-div-clock-register []
  (bit-and @div-clock-register 0xFF))
```

And now we can update our `render-future` call in `core.clj` to be sure to call `processFrame` every frame. And then for now we'll manually write to the register `0xFF04` each frame.

```clojure
;; ... at the bottom of the do block
(ioreg/processFrame)
(memory/write-byte 0xFF04 (ioreg/get-div-clock-register))
```

We can then read the value from `0xFF04` each frame to get the current value of the divider register.

```clojure
;; ... in the render-future function, where we pass the debug stuff
"div" (memory/read-byte 0xFF04)
```

![Nice and smooth](/images/div-1.gif)

## TIMA, TMA, and TAC (and part of IF)

The next three registers are part of the timer.

- `TIMA` (0xFF05) is the timer counter.
- `TMA` (0xFF06) is the timer modulo.
- `TAC` (0xFF07) is the timer control.

These 3 go hand in hand, like buddies. They all rely on each other in some horrible co-dependent way. Like the 2 best friends you had at school, who cant do anything without each other, until one day one of them moves out of town, and the other two start hanging out less because they're used to it being all three of them. You know, that classic story that absolutely never happened to me. Multiple times.

We'll start by looking at `TAC`, of 0xFF07.

`TAC` is used to start and stop the timer, and set the speed of the timer. By flipping bit 2, the timer is started or stopped. And by using a combo of bits 0 and 1, we can set the speed of the timer to 4 _totally awesome_ speeds!

![TAC](/images/tac.png)

So if 0xFF07 bit 2 is 1, then `TIMA` will start counting up at the speed decided by bits 0 and 1.

- 00 - 4096 / second
- 01 - 262144 / second
- 10 - 65536 / second
- 11 - 16384 / second

Like with the `DIV` register, we'll need to track the full 16 bit counter, and then pass the upper 8 bits to the `TIMA` register.

But unlike `DIV`, we need to do 2 things every time the timer overflows.

1. We need to reset `TIMA` to the value of `TMA`.
2. We need to trigger an interrupt.

Our `processFrame` function will need to be updated to handle this, but it's also getting a bit out of control. So I think we should have processFrame handle reading and writing to the I/O registers themselves.

```clojure
; ioreg.clj
(ns clojure-boy.ioreg
  (:require [clojure-boy.memory :as memory]))

;; DIV
(def div-clock-full (atom 0))
(def div-clock-register (atom 0))

;; TIMA
(def tima-clock-full (atom 0))
(def tima-clock-register (atom 0))

;; TAC
(def tac-clock-frequency (atom 0))
(def tac-clock-frequency-table {0 4096 1 262144 2 65536 3 16384})
(def tac-clock-enabled (atom false))

(defn- get-tima-clock-increment []
  (case @tac-clock-frequency
    4096 68
    262144 4391
    65536 994
    16384 274))

(defn- set-tac-clock-frequency [tac-byte]
  (reset! tac-clock-frequency (tac-clock-frequency-table (bit-and tac-byte 0x3)))
  (reset! tac-clock-enabled (not (zero? (bit-and tac-byte 0x4)))))

(defn processFrame []
  (set-tac-clock-frequency (memory/read-byte 0xFF07))
  ;; Increment the div clock by 70256 every frame

  (swap! div-clock-full (fn [old-val]
                          (let [new-val (+ old-val 70256)]
                            (if (> new-val 0xFFFF)
                              (mod new-val 0x10000)  ; Wrap around at 16 bits
                              new-val))))

  ;; Set the register to the upper 8 bits of the div clock
  (reset! div-clock-register (bit-and (bit-shift-right @div-clock-full 8) 0xFF))

  (when @tac-clock-enabled
    ;; Increment the full clock with proper wrapping
    (swap! tima-clock-full (fn [old-val]
                             (let [new-val (+ old-val (get-tima-clock-increment))]
                               (if (> new-val 0xFFFF)
                                 (do
                                  ;; Trigger interrupt
                                   (memory/write-byte 0xFF0F (bit-or (memory/read-byte 0xFF0F) 0x4))
                                  ;; Write TMA into TIMA
                                   (memory/write-byte 0xFF05 (memory/read-byte 0xFF06))
                                  ;; Return wrapped value
                                   (mod new-val 0x10000))
                                 new-val))))

    ;; Update the register with proper 8-bit masking
    (reset! tima-clock-register (bit-and (bit-shift-right @tima-clock-full 8) 0xFF))
    (memory/write-byte 0xFF05 @tima-clock-register))

  ;; Write DIV register
  (memory/write-byte 0xFF04 @div-clock-register))
```

And now we can update our `render-future` call in `core.clj` to be sure to call `processFrame` every frame.

```clojure
; core.clj
;; ... at inside the update-display function
"div" (memory/read-byte 0xFF04)
"tima" (memory/read-byte 0xFF05)
"tma" (memory/read-byte 0xFF06)
"tac" (memory/read-byte 0xFF07)
"IF" (memory/read-byte 0xFF0F)}))
```

## Start the timer!

We need a way to test that the timer is working. Since 0xFF07 is probably not gonna be exactly set the way we want, we should add a simple button that'll modify that value for us.

```clojure
; display.clj
(defn create-control-panel []
  "Creates a panel for debug control buttons"
  (let [panel (JPanel.)
        tac-button (JButton. "TAC")]

    ;; Add action listener to the button
    (.addActionListener tac-button
                        (proxy [java.awt.event.ActionListener] []
                          (actionPerformed [evt]
                            (let [current-byte (memory/read-byte 0xFF07)
                                  bit-2-mask (bit-shift-left 1 2)
                                  new-byte (if (zero? (bit-and current-byte bit-2-mask))
                                             (bit-or current-byte bit-2-mask)  ; Turn bit 2 on
                                             (bit-and current-byte (bit-not bit-2-mask)))] ; Turn bit 2 off
                              (memory/write-byte 0xFF07 new-byte)))))

    (doto panel
      (.setPreferredSize (Dimension. (* gb-width scale) 100))  ; 100 pixels high
      (.setBackground (Color. 220 220 220))
      (.add tac-button))
    panel))

(defn create-window []
  "Creates and shows the main application window"
  (let [frame (JFrame. "Clojure Boy")
        game-canvas (create-game-canvas)
        debug-panel (create-debug-panel)
        control-panel (create-control-panel)
        right-panel (JPanel.)]

    (doto game-canvas
      (.setPreferredSize (Dimension. (* gb-width scale)
                                     (* gb-height scale))))

    (doto right-panel
      (.setLayout (BorderLayout.))
      (.add debug-panel BorderLayout/CENTER)
      (.add control-panel BorderLayout/SOUTH))

    (doto frame
      (.setDefaultCloseOperation JFrame/EXIT_ON_CLOSE)
      (.setLayout (BorderLayout.))
      (.add game-canvas BorderLayout/CENTER)
      (.add right-panel BorderLayout/EAST)
      (.pack)
      (.setLocationRelativeTo nil)
      (.setVisible true))

    {:frame frame
     :game-canvas game-canvas
     :debug-panel debug-panel
     :control-panel control-panel}))

```

![Now with 100% more TAC](/images/tac-test-1.gif)

## Interrupt Flag and Interrupt Enable Flag

The last two registers we will look at for now is `IF` (0xFF0F) and `IE` (0xFFFF). These are the interrupt registers.

`IF` is the flag where interrupt events are stored.
`IE` is the register that enables or disables interrupts for certain events.

## What _is_ an interrupt?!

An interrupt is just that, it's something that interrupts the CPU from doing whatever it was doing, forces it to do something else, then let's it get back to whatever it was doing.

We can interrupt based on 5 different events:

| Bit | Event           |
| --- | --------------- |
| 0   | VBlank          |
| 1   | LCDC            |
| 2   | Timer Overflow  |
| 3   | Serial Transfer |
| 4   | Joypad          |

To use them, we first need to 'enable' them in the `IE` register. We do that by setting the corresponding bit to 1 from the table above.

Then, we can set the corresponding bit in the `IF` register to signal that the interrupt has occurred.

And then, that'll make the Program Counter jump to an address that relates to the interrupt event. If 2 or more interrupts are triggered at once, the interrupt with the highest priority will be executed. Just before jumping, clear the interrupt flag register all together, check the IE register, and then jump to the appropriate address if IE is enabled for that interrupt.

| Interrupt       | Bit | Priority | Jump Address |
| --------------- | --- | -------- | ------------ |
| VBlank          | 0   | 1        | 0x0040       |
| LCDC            | 1   | 2        | 0x0048       |
| Timer Overflow  | 2   | 3        | 0x0050       |
| Serial Transfer | 3   | 4        | 0x0058       |
| Joypad          | 4   | 5        | 0x0060       |

So, in summary:

1. Each frame, check the `Interrupt Flag` register to see if any interrupts are set.
2. If > 1 are set, check the priority, and action the one with the highest priority.
3. Clear the `Interrupt Flag` register.
4. Check the `Interrupt Enable` register to see if the interrupt is enabled.
5. If it is, jump to the appropriate address.
6. If it isn't, do nothing.

```clojure
(memory/write-byte 0xFF0F (bit-or (memory/read-byte 0xFF0F) 0x4))
```

This will set bit 2 of the `Interrupt Flag` register to 1, which will trigger a Timer Overflow interrupt.

## Next time

I'm pretty over IO Registers for now, and we have enough to probably get into the next bit, which will be the actual CPU instructions. As we need them, we'll continue to add more and more IO Registers!

Cya next time!
