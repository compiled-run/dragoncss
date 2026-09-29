// The slice of the WebAssembly JS API the loader uses (Node provides it; the workspace's `lib` has no DOM).
declare global {
  namespace WebAssembly {
    class Module {
      constructor(bytes: Uint8Array);
    }
    class Instance {
      constructor(module: Module, imports?: Imports);
      readonly exports: Record<string, unknown>;
    }
    class Memory {
      readonly buffer: ArrayBuffer;
    }
    type ImportValue = ((...args: never[]) => unknown) | Memory | number;
    type ModuleImports = Record<string, ImportValue>;
    type Imports = Record<string, ModuleImports>;
  }
}
export {};
