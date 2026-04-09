import "@testing-library/jest-dom";

// Mock Tauri APIs for testing
Object.defineProperty(window, "__TAURI__", {
  value: {
    core: {
      invoke: vi.fn(),
    },
  },
  writable: true,
});

Object.defineProperty(window, "__TAURI_INTERNALS__", {
  value: {
    invoke: vi.fn(),
    transformCallback: vi.fn(),
    postMessage: vi.fn(),
  },
  writable: true,
});
