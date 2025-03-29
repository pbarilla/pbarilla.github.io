# Writing a Gameboy Emulator in Clojure - Part 4 - Display

## Getting something on the screen

Clojure, as far as I know, doesnt have any way to display anything. Like, it's kind of just a REPL and that's it.
So to get something on the display, we'll need to use _all_ the tools we have available to us.

Clojure, since it's built on the JVM, has access to all the tools the JVM has to offer.
This means Java libraries, and even your own Java code, so long as it's a .class file, and it's on the classpath.

Java has a bunch of libraries for creating GUIs, the one I'm most familiar with is Swing.

> If you prefer the benefits of OpenGL, you can use [LWJGL](https://www.lwjgl.org/). For this series, I'm not going to do that, and instead will just feed pixels to the swing display. But OpenGL would be more performant, and is a great alternative for anyone wanting to try it!

## The GUI

Swing thinks of things in terms of Frames and Panels.

A Frame is the window, and Panels are the components inside the window.

I want our emulator to have 1 frame, which has 2 panels. The biggest panel will be the Gameboy screen, and the panel to the side of it will be the Debugger.

To do this, we'll create a new namespace, `display.clj`.

```clojure
;; display.clj

(ns clojure-boy.display
  (:import [javax.swing JFrame JPanel]
           [java.awt Graphics Graphics2D Color Dimension BorderLayout RenderingHints Font]
           [java.awt.image BufferedImage]))

(def gb-width 160)  ; Gameboy screen width
(def gb-height 144) ; Gameboy screen height
(def scale 3)       ; Scale factor for the display

(def debug-info (atom nil))
(def current-frame (atom nil))

(def gb-colors
  {0 (unchecked-int 0xFF9BBC0F)  ; Lightest (off)
   1 (unchecked-int 0xFF8BAC0F)  ; Light
   2 (unchecked-int 0xFF306230)  ; Dark
   3 (unchecked-int 0xFF0F380F)}) ; Darkest (on)

(defn create-game-canvas []
  "Creates a JPanel that will render the Gameboy screen"
  (proxy [JPanel] []
    (paintComponent [^Graphics g]
      (proxy-super paintComponent g)
      (let [^Graphics2D g2d (.create g)
            buffer (BufferedImage. gb-width gb-height BufferedImage/TYPE_INT_RGB)]
      ; Update buffer with pixel data (if available)
        (when-let [pixels @current-frame]
          (dotimes [y gb-height]
            (dotimes [x gb-width]
              (let [color (gb-colors (get-in pixels [y x] 0))]
                (.setRGB buffer x y color)))))

        (.drawImage g2d buffer 0 0
                    (* gb-width scale)
                    (* gb-height scale)
                    nil)))))

(defn create-debug-panel []
  "Creates a panel for debug information"

  (let [panel (proxy [JPanel] []
                (paintComponent [^Graphics g]
                  (proxy-super paintComponent g)
                  (let [^Graphics2D g2d (.create g)
                        metrics (.getFontMetrics g2d)
                        line-height (.getHeight metrics)]

                    (.setRenderingHint g2d
                                       RenderingHints/KEY_TEXT_ANTIALIASING
                                       RenderingHints/VALUE_TEXT_ANTIALIAS_ON)

                     ; Draw section headers
                    (.setColor g2d Color/DARK_GRAY)
                    (.setFont g2d (.deriveFont (.getFont g2d) Font/BOLD))

                     ; Draw values with different formatting
                    (.setFont g2d (.deriveFont (.getFont g2d) Font/PLAIN))
                    (.setColor g2d Color/BLACK)

                    (doseq [[idx [label value]] (map-indexed vector @debug-info)]
                      (.drawString g2d
                                   (str label ": " value)
                                   10
                                   (+ (* (inc idx) line-height) 10))))))]

    (doto panel
      (.setPreferredSize (Dimension. 200 (* gb-height scale)))
      (.setBackground (Color. 240 240 240)))))

; Use this in core.clj to create the window
(defn create-window []
  "Creates and shows the main application window"
  (let [frame (JFrame. "Clojure Boy")
        game-canvas (create-game-canvas)
        debug-panel (create-debug-panel)]

    (doto game-canvas
      (.setPreferredSize (Dimension. (* gb-width scale)
                                     (* gb-height scale))))

    (doto frame
      (.setDefaultCloseOperation JFrame/EXIT_ON_CLOSE)
      (.setLayout (BorderLayout.))
      (.add game-canvas BorderLayout/CENTER)
      (.add debug-panel BorderLayout/EAST)
      (.pack)
      (.setLocationRelativeTo nil)
      (.setVisible true))

    {:frame frame
     :game-canvas game-canvas
     :debug-panel debug-panel}))

(defn update-debug [& {:as new-values}]
  (swap! debug-info merge new-values))

; Use this in core.clj to update the display by passing both the raw pixel data, and any debug values you want to display.
(defn update-display [components pixel-data & {:as debug-values}]
  (reset! current-frame pixel-data)
  (when (seq debug-values)
    (update-debug debug-values))
  (.repaint (:game-canvas components))
  (.repaint (:debug-panel components)))

```

```clojure
; core.clj

; Add this somewhere near the top, where the other defs are
(def window-components (display/create-window))

; This is used to schedule the render task to run at 59.73fps
(def render-scheduler (Executors/newScheduledThreadPool 1))
(def render-future (atom nil))

; This is used to count the frames, so we can pass it to the debug display thing
(def frame-counter (atom 0))

; This is a fun little function that just creates a scrolling checkerboard pattern.
; It looks like alot of the old Gameboy screens, and is a good way to test the frame rate, etc
(defn current-frame []
  (let [offset (quot @frame-counter 2)]
    (vec (for [y (range display/gb-height)]
           (vec (for [x (range display/gb-width)]
                  (if (even? (+ (quot (+ x offset) 16)
                                (quot (+ y offset) 16)))
                    3 0)))))))

(defn main [&args]
;; ... other code ...
(reset! render-future
          (.scheduleAtFixedRate render-scheduler
                                (fn []
                                  (javax.swing.SwingUtilities/invokeLater
                                   #(do
                                      (display/update-display window-components
                                                              (checkerboard-frame)
                                                              {"rom-size" (:rom-size @system-cartridge)
                                                               "cart-type" (:cart-type @system-cartridge)
                                                               "banks-loaded" (:banks-loaded @system-cartridge)
                                                               "frame-counter" @frame-counter})
                                      (swap! frame-counter inc))))
                                0  ; initial delay
                                (long (/ 1000000000 59.73))
                                TimeUnit/NANOSECONDS)))
```

When this is all done, you'll have something that looks like this

![I swear, it looks better IRL](/images/moving-display-1.gif)

So whats happening here?

`checkerboard-frame` is a function that returns a frame of pixel data. Each pixel is represented by a number between 0-3. That represents the color of the pixel, and is used by the `update-display` function to draw the pixel to the screen. 0 is the lightest color, and 3 is the darkest. This, fundamentally, is exactly how the Gameboy display works, and so it's a great way to make sure the display works before we start adding any other features.

In the `main` function in `core.clj`, we're scheduling a task to run at 59.73fps. This is a really percise number and, honestly, doesnt need to be that exact. But we may as well strive for perfection, right? (that number is taken from the Gameboy's refresh rate, which isnt exactly 60hz, but close enough)
That task is just incrementing the `frame-counter` atom, and then calling `update-display` with the result of `checkerboard-frame` and the frame counter.

## A little bit about the Gameboy display

Modern computers are pretty safe. You can throw pixels at it, and the libraries we use will handle it. Drawing to the screen is a piece of cake, and safe. Note that word; `safe`. We can't break a users display, no matter how hard we try. I could make the most trippy, vomit inducing patterns the world has ever known, and the display would still not break. It's `safe`.

The Gameboy display is not so safe. It's not a modern computer, it's a Gameboy. We're not running an operating system on it, we're executing opcodes directly on the hardware. Each ROM is, essentially, also the OS. So each ROM has to ensure it's behaving in a way that's safe for the hardware. This is one of the many reasons why Nintendo was so strict about games releasing on its early systems, and had to have the `Nintendo Seal of Quality`. Partly because they didn't wanna release trash, but also because they didn't want some rogue game destroying hardware.

How this relates to the display is that the Gameboy reads video data directly from the VRAM. We _must not_ change the data in the VRAM except during a VBlank interrupt.

We'll get into how we know when a VBlank happens in another article, but for now, just know that we can't change the VRAM data during normal operation. So basically every ~16ms we get to update the display data, and then our display will read that data and update the screen. Since we're writing the emulator, we can do whatever we want. But to make it as accurate as possible, we should try to match the hardware as closely as possible. So we'll respect the VBlank interrupt.

## Next time

As you can see, we're kind of stubbing out the main parts of the Gameboys hardware. We'll continue that by talking about the I/O Registers, and we'll hook up some simple controls!

See you next time!
