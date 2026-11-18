# Fixture trees for `est port`

Small C++ source trees that `sdk/tests/port.test.ts` scans. Every file here was written for these
tests: it is original code, taken from no product and no framework, and none of it is ever built or
run by the suite (the scan reads text only). MIT, as the kit.

- `plain/`: one class with its methods in a `.cpp`, setters with ranges in comments, an enum of parameters.
- `with-window/`: DSP beside a `gui/` folder, a worker thread, a file read, a build file that names the C++ standard, a licence file.
- `layout/`: parameters declared in a parameter layout declaration and in a table.
- `hostile/`: text that would break a careless report: backticks, pipes, comment ends, markup, a very long line.

The hostile file names, the symbolic link and the 10 MiB file are made by the test in a temporary
folder (a file name with a line break in it does not belong in a repository).
