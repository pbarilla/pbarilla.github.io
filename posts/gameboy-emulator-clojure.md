# Writing a Gameboy Emulator in Clojure

Usually in these kind of posts, the author would write a bunch of stuff about the Gameboy, as if the reader literally has no idea what it is. We ain't doing that. Let's get right into it.

## The Rough Idea

Emulators are programs that simulate the hardware of a computer. They take the binary code of the program and execute it as if it were run on the actual hardware. They do this by stepping through the instructions one by one, and do whatever the instruction is. The program keeps track of registers, memory, display buffer, etc. We output the display buffer to the screen.

We can use the [Gameboy Technical Reference](https://gbdev.io/pandocs/) to help us figure out what we're doing.

Beep boop
