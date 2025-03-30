# Instructions - Part 1

When Gameboy programs are written, the programmers use Assembly Language. A simple Gameboy program looks like this:

```armasm
SECTION "Entry", ROM0[$100]  ; Entry point
    nop                     ; Required by boot sequence
    jp Start                ; Jump to main program

SECTION "Main", ROM0[$150]
Start:
    di                      ; Disable interrupts
    ld a, $01               ; Enable VBlank interrupt
    ld (IE), a              ; Store in Interrupt Enable register
    ei                      ; Enable interrupts

    ld hl, $9C00            ; Start of background tilemap
    ld bc, $0400            ; 1024 tiles to fill
    ld a, $00               ; Color index 0 (white)

FillScreen:
    ld (hl+), a             ; Store color in tilemap
    dec bc                  ; Decrease counter
    ld a, b
    or c
    jr nz, FillScreen       ; Loop until BC = 0

MainLoop:
    halt                    ; Wait for next interrupt
    jr MainLoop             ; Infinite loop

```

This then gets turned into opcodes, which are the actual instructions that the Gameboy can understand. This is what the rom files are, and ultimatly what we will be translating.

```armasm
00        ; NOP
C3 50 01  ; JP $0150

F3        ; DI
3E 01     ; LD A, $01
EA FF FF  ; LD ($FFFF), A  ; Write to IE
FB        ; EI

21 00 9C  ; LD HL, $9C00
01 00 04  ; LD BC, $0400
3E 00     ; LD A, $00

77        ; LD (HL), A
23        ; INC HL
0B        ; DEC BC
78        ; LD A, B
B1        ; OR C
20 FA     ; JR NZ, -6   (back to LD (HL), A)

76        ; HALT
18 FE     ; JR -2   (back to HALT)

```

If we put that into a single sequence of bytes, it'd look like this:

```armasm
00 C3 50 01 F3 3E 01 EA FF FF FB 21 00 9C 01 00 04 3E 00 77 23 0B 78 B1 20 FA 76 18 FE
```

Lets focus on the first 4 instructions for now:

```armasm
00 C3 50 01
```

We use the `Program Counter` to keep track of where we are in the program.

```armasm
00 C3 50 01
^^
Do nothing

00 C3 50 01
   ^^
   Jump to next address

00 C3 50 01
      ^^^^^
      PC becomes 0x0150
```

> If you're wondering why `50 01` becomes `0x0150`, it's because the Gameboy is little endian.

## Fetch, Decode, Execute

The core of the emulator is the `fetch`, `decode`, and `execute` cycle. It's as simple as it sounds. Each cycle, we do the following:

1. Fetch the next instruction from memory
2. Decode the instruction
3. Execute the instruction

And then go back to 1. Again and again. At least...um...carry the 1...70,000 times a frame. 70,256 to be exact. So we will need to make sure that we dont exceed that per frame.

But not every instruction takes the same amount of time to execute. Some take 1 cycle, some take 2, some take 3, etc. They're all documented in the [Gameboy CPU Manual](/resources/GBCPUman.pdf).

Let's look at the first, and simplest, instruction: `NOP`. It just does nothing. It's not `HALT`, which would stop the CPU, but it's still an instruction that takes 4 cycles to execute.

![NOP](/images/nop-opcode.png)

In `cpu.clj`, lets make a function that'll perform the fetch, decode, and execute cycle in one step.

```clojure
; core.clj
(def ready-for-next-instruction (atom false))

(defn- handle-opcode [opcode cpu]
  (let [pc (register/get-reg (:pc cpu))
        [cycles new-pc] (case opcode
                          0x00 [4 (bit-and (inc pc) 0xFFFF)]
                          (do
                            (println "Unknown opcode:" (format "0x%02X" opcode))
                            [4 (bit-and (inc pc) 0xFFFF)]))]
    (println "handle-opcode returning:" [cycles new-pc])
    [cycles new-pc]))


(defn fetch-decode-execute [cpu]
  (if @ready-for-next-instruction
    (let [opcode (memory/read-byte (register/get-reg (:pc cpu)))]
      (println "About to handle opcode:" (format "0x%02X" opcode))
      (let [[cycles new-pc] (handle-opcode opcode cpu)]
        (println "After handle-opcode, cycles:" cycles)
        (println "After handle-opcode, new-pc:" new-pc)
        (register/set-reg (:pc cpu) new-pc)
        (reset! ready-for-next-instruction false)
        cycles))
    0))


(defn enable-next-instruction []
  (println "Enabling next instruction")
  (reset! ready-for-next-instruction true))
```

We've also added a simple little latch, so that we can step through the instructions one by one while we're debugging. When we're done with that, we'll remove the `ready-for-next-instruction` and let it rip.

It's important that the `fetch-decode-execute` function returns the number of cycles it took to execute the instruction. This way we can keep track of how many cycles we've executed and make sure we don't exceed that per frame. Let's set that stuff up in `core.clj` now.

```clojure
; core.clj

; .. near the top of the file
; CPU scheduler and future
(def cpu-scheduler (Executors/newScheduledThreadPool 1))
(def cpu-future (atom nil))

; Current cycles per frame
(def current-cycles-per-frame (atom 0))
(def max-cycles-per-frame 70224)

; .. in the main function, just before we setup the render loop

; Start the CPU loop
 (reset! cpu-future
          (.scheduleAtFixedRate cpu-scheduler
                                (fn []
                                  (while (< @current-cycles-per-frame max-cycles-per-frame)
                                    (let [cycles (cpu/fetch-decode-execute cpu)]
                                      (swap! current-cycles-per-frame + cycles))))
                                0    ; initial delay
                                100  ; delay between runs, we should probably reduce this to a much lower number later
                                TimeUnit/MILLISECONDS)))

; ... and then in the render loop, we'll reset current-cycles-per-frame to 0
(reset! current-cycles-per-frame 0)

```

We wanna do the `fetch-decode-execute` function on a seperate thread to the render loop, as we dont wanna block the render loop from rendering.

We want this loop to run as often as possible, _until_ the cycles exceed ~70k per frame. If they exceed that, we'll just chill out and wait for the next frame.

So on every frame, we'll then reset the counter back to 0. And we'll just do this again and again forever.

## Lets impliment some instructions!

If you haven't already, go and download the [Gameboy CPU Manual](/resources/GBCPUman.pdf). It's a life saver. And you'll need it for the next couple of parts.

We'll start on page 65, which is a very classic one. `LD nn, n`. It takes the next immediate byte, and puts it into a CPU register.

![LD nn, n](/images/ld-opcodes.png)

So let's remmeber what we've learned so far. We have a `fetch-decode-execute` function that takes the opcode, and returns the number of cycles it takes to execute. We have a `program counter` that keeps track of where we are in the program.

So we read the memory location at `program counter`, and if that byte is `0x06,` we execure `LD B, n`. if it's `0x0E`, we execute `LD C, n`. And so on. We then increment the program counter by 2 (skipping over the byte we just read), and then return 8 cycles.

Let's make that happen. First lets just have it print what we're trying to do, increment the PC, and return the right number of cycles.

```clojure
(defn- handle-opcode [opcode cpu]
  (let [pc (register/get-reg (:pc cpu))
        [cycles new-pc] (case opcode
                          0x00 [4 (bit-and (inc pc) 0xFFFF)]
                          0x06 (println "LD B, n") [8 (bit-and (+ pc 2) 0xFFFF)]
                          0x0E (println "LD C, n") [8 (bit-and (+ pc 2) 0xFFFF)]
                          0x16 (println "LD D, n") [8 (bit-and (+ pc 2) 0xFFFF)]
                          0x1E (println "LD E, n") [8 (bit-and (+ pc 2) 0xFFFF)]
                          0x26 (println "LD H, n") [8 (bit-and (+ pc 2) 0xFFFF)]
                          0x2E (println "LD L, n") [8 (bit-and (+ pc 2) 0xFFFF)]
                          (do
                            (println "Unknown opcode:" (format "0x%02X" opcode))
                            [4 (bit-and (inc pc) 0xFFFF)]))]
    (println "handle-opcode returning:" [cycles new-pc])
    [cycles new-pc]))
```

And that'll give us an output, eventually, like this:

```bash
About to handle opcode: 0x06
LD B, n
handle-opcode returning: [8 261]
After handle-opcode, cycles: 8
After handle-opcode, new-pc: 261
```

Now you'll notice I had to change the `case` to a `cond` to handle the `do` clause.

```clojure
(defn- handle-opcode [opcode cpu]
  (let [pc (register/get-reg (:pc cpu))
        [cycles new-pc] (condp = opcode
                          0x00 [4 (bit-and (inc pc) 0xFFFF)]
                          0x06 (do (println "LD B, n") [8 (bit-and (+ pc 2) 0xFFFF)])
                          0x0E (do (println "LD C, n") [8 (bit-and (+ pc 2) 0xFFFF)])
                          0x16 (do (println "LD D, n") [8 (bit-and (+ pc 2) 0xFFFF)])
                          0x1E (do (println "LD E, n") [8 (bit-and (+ pc 2) 0xFFFF)])
                          0x26 (do (println "LD H, n") [8 (bit-and (+ pc 2) 0xFFFF)])
                          0x2E (do (println "LD L, n") [8 (bit-and (+ pc 2) 0xFFFF)])
                          (do
                            (println "Unknown opcode:" (format "0x%02X" opcode))
                            [4 (bit-and (inc pc) 0xFFFF)]))]
    (println "handle-opcode returning:" [cycles new-pc])
    [cycles new-pc]))
```

This is because, apparently, `case` doesn't allow 2 different branches to return the same value. And that's gonna happen. Alot.

Speaking of doing things alot, lets make a function that'll do the loading.

```clojure
(defn- load-register [location register-pair high-byte?]
  (try
    (let [n (memory/read-byte (bit-and (+ location 1) 0xFFFF))]
      (if high-byte?
        (register/set-hi register-pair n)
        (register/set-lo register-pair n))
      [8 (bit-and (+ location 2) 0xFFFF)])
    (catch Exception e
      (println "Error in load-register:" (.getMessage e))
      (println "Stack trace:" (with-out-str (.printStackTrace e)))
      (throw e))))

; ... in the handle-opcode function
; add this to the case statement
0x06 (do (println "LD B, n") (load-register pc (:bc cpu) true))
0x0E (do (println "LD C, n") (load-register pc (:bc cpu) false))
```

## Now what?

Well, it's this. Again and again. For like 53 pages. We just chip away at them, page at a time.

So that's what we'll do! We'll start with the first page, and we'll keep going until we have them all. And by that point, we'll have something that fetches, decodes, and executes instructions! Which, basically, is the whole emulator. Everything else is just details.
