type JestMock = {
  (...args: any[]): any;
  mock?: {
    calls: any[][];
  };
  mockImplementation: (implementation: (...args: any[]) => any) => JestMock;
  mockRejectedValueOnce: (value: unknown) => JestMock;
};

declare const describe: (name: string, fn: () => void) => void;
declare const it: (name: string, fn: () => void | Promise<void>) => void;
declare const test: (name: string, fn: () => void | Promise<void>) => void;
declare const beforeEach: (fn: () => void | Promise<void>) => void;
declare const expect: any;
declare const jest: {
  fn: (implementation?: (...args: any[]) => any) => JestMock;
  mock: (moduleName: string, factory?: () => unknown) => void;
  clearAllMocks: () => void;
  useFakeTimers: () => void;
  useRealTimers: () => void;
  advanceTimersByTime: (msToRun: number) => void;
  spyOn: (object: object, method: string) => JestMock;
  requireActual: (moduleName: string) => any;
};
declare const require: (moduleName: string) => any;
declare const __DEV__: boolean;
