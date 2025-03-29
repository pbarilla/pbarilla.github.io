# Writing a Gameboy Emulator in Clojure - Part 3 - Memory Continued

## Where we left off

In the [previous post](./gameboy-emulator-clojure-cartridge.md), we looked at the cartridge types, ROM/RAM banking, and implementing MBC controllers in Clojure.

And I kind of got stuck, because at the time I wasnt sure how to proceed.

Heres what I knew I needed to do:

- Impliment `something` to handle the cartridge data.
- Impliment a way to handle the Gameboy's memory as a `contiguous block of memory`.
- Hook the two up so that the cartridge data is used when reading from anything < 0x8000.
- Statically map anything < 0x4000 as the first 0x4000 bytes of the cartridge.
- Dynamically map anything > 0x4000 and < 0x8000 as the cartridge's bankable area.

## My first, wrong attempt

I'm learning that Clojure perhaps isnt that great at allocating a whole bunch of memory all at once. My initial attempt looked like this:

- Find how many banks there are in the cartridge (you will remember this is done by checking byte 0x148 of the cartridge)
- Allocate a vector of vectors of that size, each with 0x4000 bytes
- Copy each 0x4000 bytes of the cartridge into each of those allocated vectors
- Keep track of which bank is currently active
- Overwrite `memory` 0x4000 -> 0x7FFF with the current bank

This meant I was performing ~16k write operations for each bank switch. Bank switches can sometimes happen a couple of times per interrupt, so that's a lot of writes.

So instead lets just apply an offset to the byte we're reading from if its within the 2nd bank.

```clojure
;; memory.clj

(defn read-byte [address]
  (if (<= address (second (:rom-bank-n memory-regions)))
    (cartridge/read-byte address)
    (get @memory address)))
```

```clojure
;; cartridge.clj

(defn read-byte [address]
  (let [{:keys [rom-data]} @cartridge-state]
    (if (< address 0x4000)
      ;; Bank 0 (first 16KB) is always mapped to 0x0000-0x3FFF
      (nth rom-data address)
      ;; Switchable bank is mapped to 0x4000-0x7FFF
      (read-with-offset address))))

(defn- read-with-offset [address]
  (let [{:keys [current-bank rom-data]} @cartridge-state
        offset-address (+ (- address 0x4000) (* current-bank 0x4000))]
    (nth rom-data offset-address)))
```

There we go, that'll handle _reading_ from the correct bank area. We no longer need to slice up the cartridge into banks anymore.

Now we need to figure out _what_ bank we're using.

## I'll just go ahead and check that 'current-bank' byte that im sure exists...

Oh, you thought it was that easy huh?

The Gameboy has no clue about memory mapping. As far as it's concerned, the cartridge is just a contiguous block of 32kb.

The cartridge itself has a MBC controller. The MBC controller will determine how the cartridge is mapped into memory.

When a Gameboy game attempts to write to _any_ memory location between 0x2000 and 0x3FFF, the MBC controller will prevent that write (because it cant actually write to the cartridge ROM), and will instead test _some_ of the bits of the value it wants to write.

Up to 9 bits can be used to determine which bank to use. That allows for 512 banks with MBC5.

So we need to watch for those writes, and update our `current-bank` variable. To properly emulate the Gameboy cartridge, we will let `cartridge.clj` handle this whole process.

We'll adjust our `write-byte` function to send any write attempts on any address cartridge address to the `cartridge.clj` `write-memory` function. We'll also have to add extra protection later on for write attempts to anything > 0x8000, but we can do that later.

```clojure
;; memory.clj

(defn write-byte [address value]
  ;; If the write attempt is in the ROM and MBC register range, let the cartridge handle it
  (when-not (and (<= address (second (:rom-bank-n memory-regions))) ;; aka 0x7FFF
                 (cartridge/write-memory address value))
    ;; If not handled by cartridge, write to main memory
    ;; Note - we will add extra protection here to ensure we're not writing to restricted areas
    (swap! memory assoc address (bit-and value 0xFF))))
```

In `cartridge.clj`, lets expand our `cartridge-types` map to include all of them. And then add support for all of them in the `write-memory` function.

We'll also stub out support for all memory write operations that arent handled by the MBC controllers, but need to be handled by the cartridge.

And while we're at it, let's add support for RAM banking, too!

```clojure

(ns clojure-boy.cartridge
  (:require [clojure.java.io :as io]))

(def cartridge-types
  {0x00 {:banks 2, :name "ROM ONLY", :ram false, :battery false}
   0x01 {:banks 32, :name "MBC1", :ram false, :battery false}
   0x02 {:banks 32, :name "MBC1+RAM", :ram true, :battery false}
   0x03 {:banks 32, :name "MBC1+RAM+BATTERY", :ram true, :battery true}
   0x05 {:banks 16, :name "MBC2", :ram true, :battery false}
   0x06 {:banks 16, :name "MBC2+BATTERY", :ram true, :battery true}
   0x08 {:banks 2,  :name "ROM+RAM", :ram true, :battery false}
   0x09 {:banks 2,  :name "ROM+RAM+BATTERY", :ram true, :battery true}
   0x0B {:banks 16, :name "MMM01", :ram false, :battery false}
   0x0C {:banks 16, :name "MMM01+RAM", :ram true, :battery false}
   0x0D {:banks 16, :name "MMM01+RAM+BATTERY", :ram true, :battery true}
   0x0F {:banks 128, :name "MBC3+TIMER+BATTERY", :ram false, :battery true, :timer true}
   0x10 {:banks 64,  :name "MBC3+TIMER+RAM+BATTERY", :ram true, :battery true, :timer true}
   0x11 {:banks 64,  :name "MBC3", :ram false, :battery false}
   0x12 {:banks 64,  :name "MBC3+RAM", :ram true, :battery false}
   0x13 {:banks 64,  :name "MBC3+RAM+BATTERY", :ram true, :battery true}
   0x19 {:banks 512, :name "MBC5", :ram false, :battery false}
   0x1A {:banks 512, :name "MBC5+RAM", :ram true, :battery false}
   0x1B {:banks 512, :name "MBC5+RAM+BATTERY", :ram true, :battery true}
   0x1C {:banks 512, :name "MBC5+RUMBLE", :ram false, :battery false, :rumble true}
   0x1D {:banks 512, :name "MBC5+RUMBLE+RAM", :ram true, :battery false, :rumble true}
   0x1E {:banks 512, :name "MBC5+RUMBLE+RAM+BATTERY", :ram true, :battery true, :rumble true}
   0x20 {:banks 512, :name "MBC6", :ram true, :battery true}
   0x22 {:banks 512, :name "MBC7+SENSOR+RUMBLE+RAM+BATTERY", :ram true, :battery true, :rumble true, :sensor true}
   0xFC {:banks 512, :name "POCKET CAMERA", :ram true, :battery true, :camera true}
   0xFD {:banks 512, :name "BANDAI TAMA5", :ram true, :battery true}
   0xFE {:banks 512, :name "HuC3", :ram true, :battery true}
   0xFF {:banks 512, :name "HuC1+RAM+BATTERY", :ram true, :battery true}})

(def cartridge-aliases
  {"MBC1+RAM" "MBC1"
   "MBC1+RAM+BATTERY" "MBC1"
   "ROM+RAM+BATTERY" "ROM+RAM"
   "MBC3+RAM" "MBC3"
   "MBC3+RAM+BATTERY" "MBC3"
   "MBC3+TIMER+BATTERY" "MBC3"
   "MBC3+TIMER+RAM+BATTERY" "MBC3"
   "MMM01+RAM" "MMM01"
   "MMM01+RAM+BATTERY" "MMM01"
   "MBC5+RAM" "MBC5"
   "MBC5+RAM+BATTERY" "MBC5"
   "MBC5+RUMBLE" "MBC5"
   "MBC5+RUMBLE+RAM" "MBC5"
   "MBC5+RUMBLE+RAM+BATTERY" "MBC5"
   "HuC1+RAM+BATTERY" "HuC3"})

;; Cartridge State
(defonce cartridge-state (atom {:rom-data nil
                                :current-bank 1
                                :cart-type nil
                                :ram-enabled false
                                :ram-bank 0
                                :banking-mode 0}))

;; Core Helpers
(defn- in-range?
  [addr start end]
  (<= start addr end))

(defn- enable-ram?
  [val]
  (= 0x0A (bit-and val 0x0F)))

(defn- set-cart!
  [k v]
  (swap! cartridge-state assoc k v))

(defn- switch-bank
  [n]
  (set-cart! :current-bank n))

(defn get-current-bank
  []
  (:current-bank @cartridge-state))

;; Memory Access Helpers
(defn- write-if-in-range
  [addr start end f]
  (when (in-range? addr start end)
    (f)
    true))

(defn- handle-rom-bank
  [mask min-bank value]
  (switch-bank (max min-bank (bit-and value mask))))

;; Common MBC Operations
(defn- handle-ram-enable
  [addr val]
  (write-if-in-range addr 0x0000 0x1FFF
                     #(set-cart! :ram-enabled (enable-ram? val))))

(defn- handle-ram-bank
  [addr val mask]
  (write-if-in-range addr 0x4000 0x5FFF
                     #(set-cart! :ram-bank (bit-and val mask))))

(defn- handle-standard-rom-bank
  [addr val mask]
  (write-if-in-range addr 0x2000 0x3FFF
                     #(handle-rom-bank mask 1 val)))

(defn- handle-standard-banking
  [addr val & {:keys [rom-mask ram-mask]
               :or {rom-mask 0x7F
                    ram-mask 0x03}}]
  (or (handle-ram-enable addr val)
      (handle-standard-rom-bank addr val rom-mask)
      (handle-ram-bank addr val ram-mask)))

;; TODO Handlers
(defn- rtc-handler
  [addr val]
  (println "TODO: RTC operations at" (format "0x%04X" addr) "with" (format "0x%02X" val))
  true)

(defn- camera-handler
  [addr val]
  (println "TODO: Camera operations at" (format "0x%04X" addr) "with" (format "0x%02X" val))
  true)

(defn- sensor-handler
  [addr val]
  (println "TODO: Sensor operations at" (format "0x%04X" addr) "with" (format "0x%02X" val))
  true)

(defn- flash-handler
  [addr val]
  (println "TODO: Flash operations at" (format "0x%04X" addr) "with" (format "0x%02X" val))
  true)

;; ROM Reading
(defn- read-with-offset
  [address]
  (let [{:keys [current-bank rom-data]} @cartridge-state
        offset (+ (- address 0x4000) (* current-bank 0x4000))]
    (nth rom-data offset)))

(defn read-byte
  [address]
  (let [{:keys [rom-data]} @cartridge-state]
    (if (< address 0x4000)
      (nth rom-data address)
      (read-with-offset address))))

;; Cartridge Loading
(defn- load-cartridge
  [rom-path]
  (let [cart-bytes (vec (.readAllBytes (io/input-stream rom-path)))
        cart-type-byte (nth cart-bytes 0x147)
        cart-type (get cartridge-types cart-type-byte)]
    (reset! cartridge-state
            {:rom-data cart-bytes
             :current-bank 1
             :cart-type cart-type
             :ram-enabled false
             :ram-bank 0
             :banking-mode 0})
    {:rom-size (count cart-bytes)
     :cart-type cart-type}))

(defn init-cartridge
  [rom-path]
  (println "Initializing cartridge from:" rom-path)
  (let [info (load-cartridge rom-path)]
    {:rom-size (:rom-size info)
     :cart-type (:cart-type info)
     :banks-loaded (get-in info [:cart-type :banks])}))

;; Memory Write Implementation
(defmulti ^:private write-memory-mbc-
  (fn [addr _]
    (let [name (-> @cartridge-state :cart-type :name)]
      (get cartridge-aliases name name))))

(defmethod write-memory-mbc- "ROM ONLY" [_ _]
  false)

(defmethod write-memory-mbc- "ROM+RAM" [addr val]
  (handle-ram-enable addr val))

(defmethod write-memory-mbc- "MBC1" [addr val]
  (or (handle-standard-banking addr val :rom-mask 0x1F)
      (write-if-in-range addr 0x6000 0x7FFF
                         #(set-cart! :banking-mode (bit-and val 0x01)))))

(defmethod write-memory-mbc- "MBC2" [addr val]
  (when (in-range? addr 0x0000 0x3FFF)
    (if (zero? (bit-and addr 0x100))
      (set-cart! :ram-enabled (enable-ram? val))
      (handle-rom-bank 0x0F 1 val))
    true))

(defmethod write-memory-mbc- "MBC3" [addr val]
  (or (handle-standard-banking addr val)
      (write-if-in-range addr 0x6000 0x7FFF #(rtc-handler addr val))))

(defmethod write-memory-mbc- "MMM01" [addr val]
  (or (handle-standard-banking addr val :rom-mask 0x1F)
      (write-if-in-range addr 0x6000 0x7FFF #(println "TODO: MMM01 bank 0" addr val))))

(defmethod write-memory-mbc- "MBC5" [addr val]
  (or (handle-ram-enable addr val)
      (write-if-in-range addr 0x2000 0x2FFF #(switch-bank (bit-and val 0xFF)))
      (write-if-in-range addr 0x3000 0x3FFF
                         #(let [hi (bit-shift-left (bit-and val 0x01) 8)
                                new-bank (bit-or (bit-and (get-current-bank) 0xFF) hi)]
                            (switch-bank new-bank)))
      (handle-ram-bank addr val 0x0F)))

(defmethod write-memory-mbc- "MBC6" [addr val]
  (or (handle-ram-enable addr val)
      (write-if-in-range addr 0x2000 0x2FFF #(flash-handler addr val))
      (write-if-in-range addr 0x3000 0x3FFF #(flash-handler addr val))
      (handle-ram-bank addr val 0x07)))

(defmethod write-memory-mbc- "MBC7+SENSOR+RUMBLE+RAM+BATTERY" [addr val]
  (or (handle-standard-banking addr val)
      (write-if-in-range addr 0x4000 0x5FFF #(sensor-handler addr val))
      (write-if-in-range addr 0x6000 0x7FFF #(sensor-handler addr val))))

(defmethod write-memory-mbc- "POCKET CAMERA" [addr val]
  (or (handle-ram-enable addr val)
      (handle-standard-rom-bank addr val 0x3F)
      (write-if-in-range addr 0x4000 0x5FFF #(camera-handler addr val))
      (write-if-in-range addr 0x6000 0x7FFF #(camera-handler addr val))))

(defmethod write-memory-mbc- "BANDAI TAMA5" [addr val]
  (or (handle-standard-rom-bank addr val 0x3F)
      (write-if-in-range addr 0x4000 0x5FFF #(rtc-handler addr val))
      (write-if-in-range addr 0x6000 0x7FFF #(rtc-handler addr val))))

(defmethod write-memory-mbc- "HuC3" [addr val]
  (or (handle-standard-banking addr val)
      (write-if-in-range addr 0x4000 0x5FFF #(rtc-handler addr val))
      (write-if-in-range addr 0x6000 0x7FFF #(rtc-handler addr val))))

;; Public Interface
(defn write-memory
  [address value]
  (write-memory-mbc- address value))

```

Okay, that's alot of code. Let's break it down.

Cartridge is still initialised the same way. We've added mappings for the other Cartridge Types, and we've also added an alias map to handle the aliases.

We've added a 'ram-bank' variable to our cartridge state, to keep track of which RAM bank is currently active.

### A note on RAM Banking

Ram banking kind of behaves similar to ROM banking, so I didnt wanna go to deep into it. It works as follows:

> _Note: Memory Mode has already been selected, most likely when the Cartridge is initialised. This is done by writing either 0 or 1 in the MSB into any address between 0x6000 and 0x7FFF. (0 is 16Mbit ROM/8kb RAM mode, 1 is 4Mbit ROM/32kb RAM mode.)_

1. The RAM bank is first selected by writing a value with the lower 2 bits set to the desired bank number, to any location between 0x4000 and 0x5FFF.
2. The RAM bank is then enabled by writing a value (which is recommended by Nintendo to be 0x0A) to any location in the range 0x0000 to 0x1FFF.
3. The RAM bank is now mapped into the main address space between 0xA000 to 0xC000. Any writes to that range will instead write to the RAM bank.
4. To 'commit' the changes, any value _except_ what was written to enable the RAM (which is recommended to be 0x00) should be written to any location between 0x0000 and 0x1FFF. Saves _may_ still be preserved between power cycles, but it's just as likely that writes will occur during the power off. So it's best to 'lock' the RAM bank after any writes.
5. For Cartridges with a BATTERY, the RAM bank is preserved between power cycles. This is done by applying voltage to the cartridge's SRAM IC.
6. For Cartridges without a BATTERY, the RAM bank is lost when power is turned off.

### Back to the Code

> I noticed that there was alot of weird checking for the cartridge types. And what's interesting is that alot of the types do kind of behave the same way. MBC1, MBC+RAM, and MBC+RAM+BATTERY are all handled the same way. So we can use the alias map to find a matching cartridge type, and use that to handle everything.

For ROM ONLY, we just return false. Nothing can write to the Cartridge ROM, theres nothing to do. So bye bye.

```clojure
(defmethod write-memory-mbc- "ROM ONLY" [_ _]
  false)
```

For ROM+RAM, the only thing it _might_ be able to do is handle enabling the RAM. it'll do this by setting _any_ byte in the range 0x0000 0x1FFF to 0x0A.

```clojure
(defmethod write-memory-mbc- "ROM+RAM" [addr val]
  (handle-ram-enable addr val))
```

For MBC1, we handle the standard banking as well as the memory mode selection.

```clojure
(defmethod write-memory-mbc- "MBC1" [addr val]
  (or (handle-standard-banking addr val :rom-mask 0x1F)
      (write-if-in-range addr 0x6000 0x7FFF
                         #(set-cart! :banking-mode (bit-and val 0x01)))))
```

We wont go through all of the MBC types, but you get the idea. I've added implimentations of them above, so feel free to add them to your code!

## Summary

That's about it for the Cartridge for now. We have a way to handle Cartridge Banking, and we have a way to handle RAM Banking.
So we can stop focusing on the Cartridge for now, and move to something that's more visually pleasing.
That's right, I'm talking about the Display!

PS: We _will_ go back to the Memory later, but I wanna do something fun first!!
