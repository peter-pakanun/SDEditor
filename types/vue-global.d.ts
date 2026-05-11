export {};

type ComputedFns = Record<string, (...args: any[]) => any>;
type ComputedReturns<C extends ComputedFns> = { [K in keyof C]: ReturnType<C[K]> };

type ComponentThis<
  D extends object,
  M extends Record<string, (...args: any[]) => any>,
  C extends ComputedFns
> = D & M & ComputedReturns<C>;

type WatchCallback<TThis> = (this: TThis, ...args: any[]) => any;
type WatchHandlerObject<TThis> = {
  handler: WatchCallback<TThis>;
  deep?: boolean;
  immediate?: boolean;
} & ThisType<TThis>;
type WatchOption<TThis> = WatchCallback<TThis> | WatchHandlerObject<TThis>;
type WatchOptions<TThis> = Record<string, WatchOption<TThis>> & ThisType<TThis>;

type MethodsOptions<TThis> = Record<string, (...args: any[]) => any> & ThisType<TThis>;
type ComputedOptions<TThis, C extends ComputedFns> = C & ThisType<TThis>;

type ComponentOptions<
  D extends object,
  M extends Record<string, (...args: any[]) => any>,
  C extends ComputedFns
> = {
  data?: (this: void) => D;
  methods?: MethodsOptions<ComponentThis<D, M, C>>;
  computed?: ComputedOptions<ComponentThis<D, M, C>, C>;
  watch?: WatchOptions<ComponentThis<D, M, C>>;
  mounted?: (this: ComponentThis<D, M, C>) => any;
  beforeDestroy?: (this: ComponentThis<D, M, C>) => any;
  beforeUnmount?: (this: ComponentThis<D, M, C>) => any;
  unmounted?: (this: ComponentThis<D, M, C>) => any;
  [key: string]: any;
} & ThisType<ComponentThis<D, M, C>>;

declare global {
  const Vue: {
    defineComponent: <
      D extends object,
      M extends Record<string, (...args: any[]) => any>,
      C extends ComputedFns
    >(
      options: ComponentOptions<D, M, C>
    ) => ComponentOptions<D, M, C>;
    createApp: <
      D extends object,
      M extends Record<string, (...args: any[]) => any>,
      C extends ComputedFns
    >(
      rootComponent: ComponentOptions<D, M, C>
    ) => {
      mount: (selector: string) => any;
    };
  };
}
