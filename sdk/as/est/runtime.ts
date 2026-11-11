// EST's AssemblyScript runtime: AssemblyScript's own `stub` runtime (std/assembly/rt/stub.ts,
// assemblyscript 0.28, Apache-2.0, Copyright the AssemblyScript authors), changed in one way: its
// heap offset is found on the first allocation instead of in the module's start function. The
// host meters every module (D-30) and gives fuel only before each call, so a start function would
// trap at instantiation; with this runtime an EST module built by AssemblyScript has none.
// Use it with `"runtime": "<path>/est/runtime"` in asconfig.json. Like the stub, it never frees
// except the last block, so a plugin allocates while setting up and never while processing.

import { AL_MASK, OBJECT, OBJECT_OVERHEAD, BLOCK_MAXSIZE, BLOCK_OVERHEAD, BLOCK, OBJECT_MAXSIZE } from "rt/common";
import { E_ALLOCATION_TOO_LARGE } from "util/error";

let offset: usize = 0;

// @ts-ignore: decorator
@inline function startOffset(): usize {
  return ((__heap_base + BLOCK_OVERHEAD + AL_MASK) & ~AL_MASK) - BLOCK_OVERHEAD;
}

// @ts-ignore: decorator
@inline function top(): usize {
  if (offset == 0) offset = startOffset();
  return offset;
}

function maybeGrowMemory(newOffset: usize): void {
  let pagesBefore = memory.size();
  let maxOffset = ((<usize>pagesBefore << 16) + AL_MASK) & ~AL_MASK;
  if (newOffset > maxOffset) {
    let pagesNeeded = <i32>(((newOffset - maxOffset + 0xffff) & ~0xffff) >>> 16);
    let pagesWanted = max(pagesBefore, pagesNeeded);
    if (memory.grow(pagesWanted) < 0) {
      if (memory.grow(pagesNeeded) < 0) unreachable();
    }
  }
  offset = newOffset;
}

// @ts-ignore: decorator
@inline function computeSize(size: usize): usize {
  return ((size + BLOCK_OVERHEAD + AL_MASK) & ~AL_MASK) - BLOCK_OVERHEAD;
}

// @ts-ignore: decorator
@unsafe @global
function __alloc(size: usize): usize {
  if (size > BLOCK_MAXSIZE) throw new Error(E_ALLOCATION_TOO_LARGE);
  let at = top();
  let block = changetype<BLOCK>(at);
  let ptr = at + BLOCK_OVERHEAD;
  let payloadSize = computeSize(size);
  maybeGrowMemory(ptr + payloadSize);
  block.mmInfo = payloadSize;
  return ptr;
}

// @ts-ignore: decorator
@unsafe @global
function __realloc(ptr: usize, size: usize): usize {
  assert(ptr != 0 && !(ptr & AL_MASK));
  let block = changetype<BLOCK>(ptr - BLOCK_OVERHEAD);
  let actualSize = block.mmInfo;
  let isLast = ptr + actualSize == top();
  let payloadSize = computeSize(size);
  if (size > actualSize) {
    if (isLast) {
      if (size > BLOCK_MAXSIZE) throw new Error(E_ALLOCATION_TOO_LARGE);
      maybeGrowMemory(ptr + payloadSize);
      block.mmInfo = payloadSize;
    } else {
      let newPtr = __alloc(max<usize>(payloadSize, actualSize << 1));
      memory.copy(newPtr, ptr, actualSize);
      block = changetype<BLOCK>((ptr = newPtr) - BLOCK_OVERHEAD);
    }
  } else if (isLast) {
    offset = ptr + payloadSize;
    block.mmInfo = payloadSize;
  }
  return ptr;
}

// @ts-ignore: decorator
@unsafe @global
function __free(ptr: usize): void {
  assert(ptr != 0 && !(ptr & AL_MASK));
  let block = changetype<BLOCK>(ptr - BLOCK_OVERHEAD);
  if (ptr + block.mmInfo == top()) offset = changetype<usize>(block);
}

// @ts-ignore: decorator
@unsafe @global
function __reset(): void {
  offset = startOffset();
}

// @ts-ignore: decorator
@unsafe @global
function __new(size: usize, id: u32): usize {
  if (size > OBJECT_MAXSIZE) throw new Error(E_ALLOCATION_TOO_LARGE);
  let ptr = __alloc(OBJECT_OVERHEAD + size);
  let object = changetype<OBJECT>(ptr - BLOCK_OVERHEAD);
  object.gcInfo = 0;
  object.gcInfo2 = 0;
  object.rtId = id;
  object.rtSize = <u32>size;
  return ptr + OBJECT_OVERHEAD;
}

// @ts-ignore: decorator
@unsafe @global
function __renew(oldPtr: usize, size: usize): usize {
  if (size > OBJECT_MAXSIZE) throw new Error(E_ALLOCATION_TOO_LARGE);
  let newPtr = __realloc(oldPtr - OBJECT_OVERHEAD, OBJECT_OVERHEAD + size);
  changetype<OBJECT>(newPtr - BLOCK_OVERHEAD).rtSize = <u32>size;
  return newPtr + OBJECT_OVERHEAD;
}

// @ts-ignore: decorator
@global @unsafe
function __link(parentPtr: usize, childPtr: usize, expectMultiple: bool): void {}

// @ts-ignore: decorator
@global @unsafe
function __pin(ptr: usize): usize { return ptr; }

// @ts-ignore: decorator
@global @unsafe
function __unpin(ptr: usize): void {}

// @ts-ignore: decorator
@global @unsafe
function __visit(ptr: usize, cookie: u32): void {}

// @ts-ignore: decorator
@global @unsafe
function __collect(): void {}
