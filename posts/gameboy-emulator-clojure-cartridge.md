# Writing a Gameboy Emulator in Clojure - Part 2 - Memory

## Some prerequiste stuff

### Notation

Typically, we will use the hex notation to refer to memory addresses. The shorthand for this is sometimes shown as `0x1234`, but it's also sometimes written as `$1234` or `1234h`.

When we refer to binary, we will use the notation `%01010011`, but sometimes this is written as `b01010011` or `#b01010011`.

I prefer the `0x` notation, but you can use whichever you're comfortable with.

### Endianness

CPUs can be either little or big endian. The word comes from the story Gulliver's Travels, where the Lilliputians are divided based on how they eat their hard-boiled eggs, from the Big End first, or the Little End first.

Little Endian CPUs access memory from the least significant byte first, and Big Endian CPUs access memory from the most significant byte first.

For example, the number `5678` in hex is `0x162E` in little endian, and `0x2E16` in big endian.
0x16 is the least significant byte, and 0x2E is the most significant byte.

The Gameboy is little endian.

## Memory

![Super Dooper Fancy Memory Map](/images/super-offical-memory-map.png)

Theres a bunch of stuff here, but lets just focus on the first 32kb of memory. But first, _another_ note on memory!

### ROM Banking

If it's not obvious by now, Gameboys have very little memory. The original Super Mario Land is about 32kb. For comparison, the image linked above is about 250kb. You could fit close to 8 Super Mario Lands in that image.

And, by design, the Gameboy's internal memory only allows a Gameboy cartridge to be 32kb in size.

So how do we fit more than 32kb of data on a cartridge? ROM Banking!

Let's look at a slightly simplified memory map of the cartridge.

![Simplified Memory Map](/images/memory-map.png)

(The memory is listed in the opposite order in this one, but you get the idea. In fact, this way of viewing it is how the Gameboy CPU sees it, staring from the lowest address and growing upwards.)

Consider the first 32kb of memory. You'll notice that:

| Address Range   | Description         | Example Usage                           |
| --------------- | ------------------- | --------------------------------------- |
| 0x4000 - 0x7FFF | Switchable ROM Bank | Can be switched out on the fly.         |
| 0x0000 - 0x3FFF | Cartridge ROM       | Cannot change after cartridge is loaded |

How do I describe this better, because so far I've just repeated the same thing a bunch of times.

Okay remember playing games on the Playstation, like Final Fantasy 7 or Metal Gear Solid? They'd come on 2+ discs.

You'd start from Disc 1, and then at some point Psycho Mantis would freak you out by 'making the controller move by itself',
and then you'd be told to put in Disc 2? That's what ROM banking is.

So a game like Pokemon has the same 16kb loaded from 0x0000 -> 0x3FFF, but then it'd be able to switch
to a different 16kb at 0x4000 -> 0x7FFF. That's Disc 2, 3, 4, etc. That's how we can get huge games like Pokemon to
fit in a memory footprint smaller than an MP3 of the Pokemon theme song.

## Defining the Memory

We'll start by defining the memory in our emulator. Lets start by creating a simple test harness.

```clojure
;; memory-test.clj
(ns clojure-boy.memory-test
  (:require [clojure.test :refer :all]
            [clojure-boy.memory :as memory]))

(deftest test-write-read
    (testing "Test write and read"
        (let [memory (memory/make-memory)]
            (memory/write-byte memory 0x00 0xAB)
            (is (= 0xAB (memory/read-byte memory 0x00))))))
```

```clojure
;; memory.clj
(ns clojure-boy.memory)

;; 64kb of memory
(def memory-size 0x10000)

(def memory (atom (vec (repeat memory-size 0))))

(defn make-memory []
  (atom(vec (repeat memory-size 0))))

(defn read-byte [memory address]
  (get @memory address))

(defn write-byte [memory address value]
  (swap! memory assoc address value)
  memory)
```

```bash
lein test clojure-boy.memory-test
```

Now remember, I'm still learning Clojure, so maybe this isnt the best way to do things. But it's probably
the most performant.

We'll use an atom to represent the memory, and we'll use the `swap!` function to update the memory. And while I'd like to give some long-winded speech about how the "epochal model of time" suits our needs perfectly...

I'm not going to. Because it's probably not true. But since we're modifying memory, it makes the most sense to have _some kind_ of guarantee that our operations are going to do what they should do, or do nothing at all.
I'm not thrilled about the idea of operations getting stuck in a spin-loop, but it'll also make sure that we're writing pure functions without side effects.

So it's basically like we're forcing ourselves to think about what we're doing.

## Loading a Cartridge

Let's start by picking a Gameboy cartridge. Since I'm not keen to violate copyright law this early in the series, we'll start with one of the classic blargg test roms. You can grab them [here](https://github.com/c-sp/game-boy-test-roms/tree/master?tab=readme-ov-file) or [here](https://github.com/retrio/gb-test-roms/tree/master). I'm going to use [cpu_instrs.gb](https://github.com/retrio/gb-test-roms/blob/master/cpu_instrs/cpu_instrs.gb).

I've just realised I've bored myself writing this. Let's cut to the chase a bit, huh?

1. Theres a bunch of locations in memory called 'Reserved Memory Locations'. You can find them on Page 10 of [this PDF](/resources/GBCPUman.pdf).
2. The first 16kb of the cartridge is loaded into the first 16kb of the gameboys memory map.
3. The special locations we care about right now are:

| Address | Description    | Notes                        |
| ------- | -------------- | ---------------------------- |
| 0x0147  | Cartridge Type | 26 types                     |
| 0x148   | ROM Size       | 10 types, from 32kb to 1.5mb |
| 0x149   | RAM Size       | 5 types, from 0kb to 128kb   |

(Note: RAM can be banked, too! But we'll ignore that for now.)

4. Since theres literally 26 kinds of cartridges, including wild ones like '0x1F', which is the 'Pocket Camera', we'll ignore most of them besides the first few ones.

| Hex  | Description                | Example games                             |
| ---- | -------------------------- | ----------------------------------------- |
| 0x00 | ROM ONLY                   | Tetris, Dr. Mario                         |
| 0x01 | ROM + MBC1                 | Aladdin, Alien 3                          |
| 0x02 | ROM + MBC1 + RAM           | Okay, this seems to just be tech demos... |
| 0x03 | ROM + MBC1 + RAM + BATTERY | Pokemon Red/Blue, Kirby 2                 |

5. 0x148 tells us how many ROM banks there are, and how big the cartridge is. Or the upper limit of how big the cartridge can be.

| Hex  | Bits    | Bytes | Bank Count | Notes        |
| ---- | ------- | ----- | ---------- | ------------ |
| 0x00 | 256Kbit | 32kb  | 2          |              |
| 0x01 | 512Kbit | 64kb  | 4          |              |
| 0x02 | 1Mbit   | 128kb | 8          |              |
| 0x03 | 2Mbit   | 256kb | 16         |              |
| 0x04 | 4Mbit   | 512kb | 32         |              |
| 0x05 | 8Mbit   | 1mb   | 64         |              |
| 0x52 | 9MBit   | 1.1mb | 72         | Added in GBC |
| 0x53 | 10MBit  | 1.2mb | 80         | Added in GBC |
| 0x54 | 12Mbit  | 1.5mb | 96         | Added in GBC |
| 0x06 | 16Mbit  | 2mb   | 128        |              |

6. So when we load a cartridge, we need to:

- Load the first 16kb of the cartridge into memory.
- Test 0x147 to see what kind of cartridge we have.
  - If it's 0x00, we have a ROM ONLY cartridge.
  - If it's 0x01, we have a ROM + MBC1 cartridge.
  - If it's 0x02, we have a ROM + MBC1 + RAM cartridge, which means we have some weird tech demo on our hands. So we'll ignore that and maybe clean our browser history...
  - If it's 0x03, we have a ROM + MBC1 + RAM + BATTERY cartridge.
- Test 0x148 to see how many ROM banks we have.
  - We'll chunk the cartridge into 16kb segments, and then load each segment into memory. Then we can swap them out on the fly.
- Test 0x149 to see how many RAM banks we have.
  - More on this later...

Let's start by loading the cartridge into memory.

```clojure
;; cartridge.clj

;; Define cartridge types first
;; Note: This is not exhaustive, but it's enough for now
(def cartridge-types
  {0x00 {:banks 2
         :name "ROM ONLY"
         :ram false
         :battery false}
   0x01 {:name "MBC1"
         :banks 32
         :ram false
         :battery false}
   0x02 {:name "MBC1+RAM"
         :banks 32
         :ram true
         :battery false}
   0x03 {:name "MBC1+RAM+BATTERY"
         :banks 32
         :ram true
         :battery true}})

;; Define the cartridge state
(def cartridge-state (atom {:rom-data nil
                            :current-bank 1
                            :cart-type nil}))

;; Private functions

(defn- load-cartridge [rom-path]
  (let [cart-bytes (vec (.readAllBytes (io/input-stream rom-path)))
        cart-type-byte (nth cart-bytes 0x147)
        cart-type (get cartridge-types cart-type-byte)]
    (reset! cartridge-state
            {:rom-data cart-bytes
             :current-bank 1
             :cart-type cart-type})
    {:rom-size (count cart-bytes)
     :cart-type cart-type}))

;; Public functions

(defn init-cartridge [rom-path]
  (println "Initializing cartridge from:" rom-path)
  (let [cart-info (load-cartridge rom-path)]
    ;; Return useful info about the loaded cartridge
    {:rom-size (:rom-size cart-info)
     :cart-type (:cart-type cart-info)
     :banks-loaded (get-in (:cart-type cart-info) [:banks])}))
```

```clojure
;; core.clj
(def system-cartridge (atom nil))  ; Will be initialized when loading ROM

(defn -main [& args]
  (if-let [rom-path (first args)]
    (do
      (println "Initializing with ROM:" rom-path)
      (let [cart (cartridge/init-cartridge rom-path)]
        (reset! system-cartridge cart)
        (println "Cartridge initialized:")
        (println "ROM size:" (:rom-size cart))
        (println "Cartridge type:" (:cartridge-type cart))
        (println "Banks loaded:" (:banks-loaded cart))

        (println "First few bytes of ROM:")
        (doseq [addr (range 5)]
          (println (format "Byte 0x%04X: 0x%02X"
                           addr
                           (cartridge/read-byte addr))))))
    (println "Please provide a ROM file path as an argument"))
  (if-let [cartridge @system-cartridge]
    (println "Cartridge Exists" cartridge)
    (println "cartridge doesnt exist")))
```

```bash
lein run roms/cpu_instrs.gb
```

```
Initializing with ROM: roms/cpu_instrs.gb
Initializing cartridge from: roms/cpu_instrs.gb
Cartridge initialized:
ROM size: 65536
Cartridge type: {:name MBC1, :banks 32, :ram false, :battery false}
Banks loaded: 32
First few bytes of ROM:
Byte 0x0000: 0x3C
Byte 0x0001: 0xC9
Byte 0x0002: 0x00
Byte 0x0003: 0x00
Byte 0x0004: 0x00
Cartridge Exists {:rom-size 65536, :cart-type {:name MBC1, :banks 32, :ram false, :battery false}, :banks-loaded 32}
```

## So what are we doing here?

### cartridge.clj

We have a simple namespace for our cartridge, which we will use to load our cartridge. We only ever need to
have 1 cartridge loaded at a time, so we'll use an atom to store the cartridge state.

When we load the cartridge, we just store the whole thing into the state atom. We also store what bank we're currently using.

What's missing from the file above is the ability to switch banks, and read from the different banks. We'll get to that later.

### core.clj

This is our main namespace, which we'll use to load our cartridge. For now we're just loading it from an argument that's passed in when running the program, and then outputting some 'super dooper helpful information' about the cartridge.

## Summary

We've loaded a cartridge into memory, and we're able to read from it.

Next time, we'll look at how to switch banks, how to read from the different banks, and how to coordinate this with our existing memory namespace.
