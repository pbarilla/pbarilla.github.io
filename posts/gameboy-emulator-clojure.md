# Writing a Gameboy Emulator in Clojure - Part 1 - Registers

Usually in these kind of posts, the author would write a bunch of stuff about the Gameboy, as if the reader literally has no idea what it is. We ain't doing that. Let's get right into it.

## The Rough Idea

Emulators are programs that simulate the hardware of a computer. They take the binary code of the program and execute it as if it were run on the actual hardware. They do this by stepping through the instructions one by one, and do whatever the instruction is. The program keeps track of registers, memory, display buffer, etc. We output the display buffer to the screen.

We'll be using [Gameboy CPU Manual](/resources/GBCPUman.pdf) and [Gameboy Programming Manual](/resources/GameBoyProgManVer1.1.pdf) as references for this project.

![Gameboy Block Diagram](/images/gb-block-diagram.png)

## Core Concepts

### CPU

The Gameboy CPU is a modified Z80 CPU. It has 8-bit registers, and 16-bit registers.

We refer to the registers in pairs. Each single register is 8 bits long (BYTE). The pairs, when used together, form a 16-bit register (WORD).

The Stack Pointer and Program Counter are 16-bit registers.

| Register        | Register | Pair |
| --------------- | -------- | ---- |
| A               | F        | AF   |
| B               | C        | BC   |
| D               | E        | DE   |
| H               | L        | HL   |
| Stack Pointer   |          | SP   |
| Program counter |          | PC   |

The Gameboy is Little Endian. This means that the least significant byte is stored first. We refer to each register in the pair as either 'Lo' or 'Hi'.

| WORD   | Lo Byte | Hi Byte |
| ------ | ------- | ------- |
| 0x1234 | 0x34    | 0x12    |

We'll create a new class to represent each register pair, but instead of storing the lo or hi bytes individually, we'll store the combined value of both, as 'reg'.
We'll make get-lo, get-hi, set-lo, and set-hi methods to adjust the 16 bit word's hi or lo nibbles to access each register in the pair.

```
(ns clojure-boy.register)

(defn make-register
  "Creates a new 16-bit register initialized to 0"
  []
  (atom 0))

(defn get-hi
  "Gets the high byte (bits 8-15) of the register"
  [r]
  (bit-and (bit-shift-right @r 8) 0xFF))

(defn get-lo
  "Gets the low byte (bits 0-7) of the register"
  [r]
  (bit-and @r 0xFF))

(defn get-reg
  "Gets the full 16-bit value of the register"
  [r]
  @r)

(defn set-hi
  "Sets the high byte (bits 8-15) of the register"
  [r value]
  (swap! r #(bit-or (bit-and % 0x00FF)
                    (bit-shift-left (bit-and value 0xFF) 8))))

(defn set-lo
  "Sets the low byte (bits 0-7) of the register"
  [r value]
  (swap! r #(bit-or (bit-and % 0xFF00)
                    (bit-and value 0xFF))))

(defn set-reg
  "Sets the full 16-bit value of the register"
  [r value]
  (reset! r (bit-and value 0xFFFF)))

```

Lets start by writing some simple tests

```
(deftest simple-test
  (testing "Testing retrieving lo and hi bytes"
    (let [reg (register/make-register)]
      (register/set-reg reg 0xCCBB)
      (is (= 0xCC (register/get-hi reg)))
      (is (= 0xBB (register/get-lo reg)))
      (is (= 0xCCBB (register/get-reg reg)))
      ;; Overwrite hi to be 0xAA, but keep lo the same (0xBB)
      (register/set-hi reg 0xAA)
      (is (= 0xAA (register/get-hi reg)))
      (is (= 0xBB (register/get-lo reg)))
      (is (= 0xAABB (register/get-reg reg))))))
```

As you can see, we start by setting the register to 0xCCBB.
Then we retrieve the hi and lo bytes, and verify that they are correct.
Then we retrieve the full 16-bit value of the register and verify that it is correct.
We then overwrite the hi byte to be 0xAA, but keep the lo byte the same (0xBB).
We verify that the hi byte is now 0xAA, the lo byte is still 0xBB, and the full 16-bit value is 0xAABB.

And that's really it for the register class. We'll now create a CPU class that'll use these registers.

```
(ns clojure-boy.cpu
  (:require [clojure-boy.register :as register]))

(defn cpu []
  {:af (register/make-register)
   :bc (register/make-register)
   :de (register/make-register)
   :hl (register/make-register)
   :pc (register/make-register)
   :sp (register/make-register)})

(defn init [cpu]
  (register/set-reg (:af cpu) 0x0000)
  (register/set-reg (:bc cpu) 0x0000)
  (register/set-reg (:de cpu) 0x0000)
  (register/set-reg (:hl cpu) 0x0000)
  (register/set-reg (:pc cpu) 0x0100)
  (register/set-reg (:sp cpu) 0xFFFE))
```

We initialise the SP and PC to the values described in the GB Programming Manual.

We'll now create a test to verify that the CPU is initialised correctly.

```
(deftest init-cpu
  (testing "Initializing a CPU"
    (let [cpu (cpu/cpu)]
      (cpu/init cpu)
      (is (= 0x0000 (register/get-reg (:af cpu))))
      (is (= 0x0000 (register/get-reg (:bc cpu))))
      (is (= 0x0000 (register/get-reg (:de cpu))))
      (is (= 0x0000 (register/get-reg (:hl cpu))))
      (is (= 0x0100 (register/get-reg (:pc cpu))))
      (is (= 0xFFFE (register/get-reg (:sp cpu)))))))
```

Now is as good a time as any to start talking about the Program Counter, Stack Pointer, Accumulator, and Flags.

### Program Counter

The Program Counter is the address of the next instruction to execute.

Imaging one of those 'Choose your own adventure' books. You know the ones, there'll be some story and you make choices, and before you know it you've taken
the wrong path and killed the main character by drinking a poison chalise or something.

So you're reading along, and you come to a page that says "You can either go left or right". Depending on what you choose, it'll tell you to go to a different page.

Think of the Program Counter as the page you're about to flip to. It starts at 1, and increases as you flip through the pages. But occasionally, you'll advance it to
a different page based on the choices you made.

The Program Counter will always increment by 1 when an instruction is executed, unless the instruction (or something else) tells you to set it to something else.

How simple is that?

### Stack Pointer

The Stack Pointer is the address of the next free location in the stack.

It's pretty much the same as the Program Counter, but it's used for the stack instead of the program.

The stack is a portion of memory that is last in, first out. It's (typically) used for storing the return address of a function call, but otherthings may write to it.

The stack grows downwards, meaning that the stack pointer is decremented as you push more values onto the stack. It starts at 0xFFFE which is the absolute last
address of the Gameboy's internal memory.

### Accumulator

The Accumulator is a register that is used to store the result of an operation. As you may have guessed, it's register A.
There are plenty of instructions (that we'll start implimenting very soon) that use the accumulator in one way or another.

### Flags

The Flags are a set of bits that are used to store the status of the CPU. They are stored in register F.

| Flag | Name       |
| ---- | ---------- |
| Z    | Zero       |
| N    | Subtract   |
| H    | Half Carry |
| C    | Carry      |

| 7   | 6   | 5   | 4   | 3   | 2   | 1   | 0   |
| --- | --- | --- | --- | --- | --- | --- | --- |
| Z   | N   | H   | C   | 0   | 0   | 0   | 0   |

We'll create some helper functions to access and modify the flags. We'll also create some tests to verify that they work.

```
(defn set-bit
  "bit should be 0-7, byte-select should be :hi or :lo, bit-value should be true or false"
  [r bit byte-select bit-value]
  (let [mask (bit-shift-left 1 bit)
        inverse-mask (bit-not mask)
        current (if (= byte-select :hi)
                 (get-hi r)
                 (get-lo r))
        new-value (if bit-value
                   (bit-or current mask)
                   (bit-and current inverse-mask))]
    (if (= byte-select :hi)
      (set-hi r new-value)
      (set-lo r new-value))))

(defn test-bit
  "bit should be 0-7, byte-select should be :hi or :lo"
  [r bit byte-select]
  (let [value (if (= byte-select :hi)
                (get-hi r)
                (get-lo r))
        mask (bit-shift-left 1 bit)]
    (not (zero? (bit-and value mask)))))
```

And the tests.

```
(deftest test-flag
  (testing "Testing flag operations"
    (let [r (register/make-register)]
      (register/set-reg r 0x0000)
      (register/set-hi r 0xAA) ; Set hi byte to 10101010
      (is (not (register/test-bit r 0 :hi))) ; Test bit 0 is not set (0)
      (is (register/test-bit r 1 :hi)) ; Test bit 1 is set (1)
      (is (not (register/test-bit r 2 :hi))) ; Test bit 2 is not set (0)
      (is (register/test-bit r 3 :hi)) ; Test bit 3 is set (1)
      (is (not (register/test-bit r 4 :hi))) ; Test bit 4 is not set (0)
      (is (register/test-bit r 5 :hi)) ; Test bit 5 is set (1)
      (is (not (register/test-bit r 6 :hi))) ; Test bit 6 is not set (0)
      (is (register/test-bit r 7 :hi)) ; Test bit 7 is set (1)
      )))
```

Next time we'll define the memory, and then we'll start writing the instructions.
