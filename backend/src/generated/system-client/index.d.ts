
/**
 * Client
**/

import * as runtime from './runtime/library.js';
import $Types = runtime.Types // general types
import $Public = runtime.Types.Public
import $Utils = runtime.Types.Utils
import $Extensions = runtime.Types.Extensions
import $Result = runtime.Types.Result

export type PrismaPromise<T> = $Public.PrismaPromise<T>


/**
 * Model agent_lab_configs
 * 
 */
export type agent_lab_configs = $Result.DefaultSelection<Prisma.$agent_lab_configsPayload>
/**
 * Model agent_model_configs
 * 
 */
export type agent_model_configs = $Result.DefaultSelection<Prisma.$agent_model_configsPayload>
/**
 * Model agent_prompts
 * 
 */
export type agent_prompts = $Result.DefaultSelection<Prisma.$agent_promptsPayload>
/**
 * Model agent_definitions
 * 
 */
export type agent_definitions = $Result.DefaultSelection<Prisma.$agent_definitionsPayload>
/**
 * Model orchestrator_definitions
 * 
 */
export type orchestrator_definitions = $Result.DefaultSelection<Prisma.$orchestrator_definitionsPayload>
/**
 * Model agent_registrations
 * 
 */
export type agent_registrations = $Result.DefaultSelection<Prisma.$agent_registrationsPayload>
/**
 * Model platform_api_configs
 * 
 */
export type platform_api_configs = $Result.DefaultSelection<Prisma.$platform_api_configsPayload>
/**
 * Model platform_settings
 * 
 */
export type platform_settings = $Result.DefaultSelection<Prisma.$platform_settingsPayload>
/**
 * Model skill_model_configs
 * 
 */
export type skill_model_configs = $Result.DefaultSelection<Prisma.$skill_model_configsPayload>
/**
 * Model skill_registrations
 * 
 */
export type skill_registrations = $Result.DefaultSelection<Prisma.$skill_registrationsPayload>
/**
 * Model field_definitions
 * 
 */
export type field_definitions = $Result.DefaultSelection<Prisma.$field_definitionsPayload>
/**
 * Model agent_contracts
 * 
 */
export type agent_contracts = $Result.DefaultSelection<Prisma.$agent_contractsPayload>
/**
 * Model agent_field_routings
 * 
 */
export type agent_field_routings = $Result.DefaultSelection<Prisma.$agent_field_routingsPayload>
/**
 * Model node_config_changes
 * 
 */
export type node_config_changes = $Result.DefaultSelection<Prisma.$node_config_changesPayload>
/**
 * Model prompt_eval_cases
 * 
 */
export type prompt_eval_cases = $Result.DefaultSelection<Prisma.$prompt_eval_casesPayload>
/**
 * Model prompt_eval_runs
 * 
 */
export type prompt_eval_runs = $Result.DefaultSelection<Prisma.$prompt_eval_runsPayload>

/**
 * ##  Prisma Client ʲˢ
 * 
 * Type-safe database client for TypeScript & Node.js
 * @example
 * ```
 * const prisma = new PrismaClient()
 * // Fetch zero or more Agent_lab_configs
 * const agent_lab_configs = await prisma.agent_lab_configs.findMany()
 * ```
 *
 * 
 * Read more in our [docs](https://www.prisma.io/docs/reference/tools-and-interfaces/prisma-client).
 */
export class PrismaClient<
  ClientOptions extends Prisma.PrismaClientOptions = Prisma.PrismaClientOptions,
  U = 'log' extends keyof ClientOptions ? ClientOptions['log'] extends Array<Prisma.LogLevel | Prisma.LogDefinition> ? Prisma.GetEvents<ClientOptions['log']> : never : never,
  ExtArgs extends $Extensions.InternalArgs = $Extensions.DefaultArgs
> {
  [K: symbol]: { types: Prisma.TypeMap<ExtArgs>['other'] }

    /**
   * ##  Prisma Client ʲˢ
   * 
   * Type-safe database client for TypeScript & Node.js
   * @example
   * ```
   * const prisma = new PrismaClient()
   * // Fetch zero or more Agent_lab_configs
   * const agent_lab_configs = await prisma.agent_lab_configs.findMany()
   * ```
   *
   * 
   * Read more in our [docs](https://www.prisma.io/docs/reference/tools-and-interfaces/prisma-client).
   */

  constructor(optionsArg ?: Prisma.Subset<ClientOptions, Prisma.PrismaClientOptions>);
  $on<V extends U>(eventType: V, callback: (event: V extends 'query' ? Prisma.QueryEvent : Prisma.LogEvent) => void): void;

  /**
   * Connect with the database
   */
  $connect(): $Utils.JsPromise<void>;

  /**
   * Disconnect from the database
   */
  $disconnect(): $Utils.JsPromise<void>;

  /**
   * Add a middleware
   * @deprecated since 4.16.0. For new code, prefer client extensions instead.
   * @see https://pris.ly/d/extensions
   */
  $use(cb: Prisma.Middleware): void

/**
   * Executes a prepared raw query and returns the number of affected rows.
   * @example
   * ```
   * const result = await prisma.$executeRaw`UPDATE User SET cool = ${true} WHERE email = ${'user@email.com'};`
   * ```
   * 
   * Read more in our [docs](https://www.prisma.io/docs/reference/tools-and-interfaces/prisma-client/raw-database-access).
   */
  $executeRaw<T = unknown>(query: TemplateStringsArray | Prisma.Sql, ...values: any[]): Prisma.PrismaPromise<number>;

  /**
   * Executes a raw query and returns the number of affected rows.
   * Susceptible to SQL injections, see documentation.
   * @example
   * ```
   * const result = await prisma.$executeRawUnsafe('UPDATE User SET cool = $1 WHERE email = $2 ;', true, 'user@email.com')
   * ```
   * 
   * Read more in our [docs](https://www.prisma.io/docs/reference/tools-and-interfaces/prisma-client/raw-database-access).
   */
  $executeRawUnsafe<T = unknown>(query: string, ...values: any[]): Prisma.PrismaPromise<number>;

  /**
   * Performs a prepared raw query and returns the `SELECT` data.
   * @example
   * ```
   * const result = await prisma.$queryRaw`SELECT * FROM User WHERE id = ${1} OR email = ${'user@email.com'};`
   * ```
   * 
   * Read more in our [docs](https://www.prisma.io/docs/reference/tools-and-interfaces/prisma-client/raw-database-access).
   */
  $queryRaw<T = unknown>(query: TemplateStringsArray | Prisma.Sql, ...values: any[]): Prisma.PrismaPromise<T>;

  /**
   * Performs a raw query and returns the `SELECT` data.
   * Susceptible to SQL injections, see documentation.
   * @example
   * ```
   * const result = await prisma.$queryRawUnsafe('SELECT * FROM User WHERE id = $1 OR email = $2;', 1, 'user@email.com')
   * ```
   * 
   * Read more in our [docs](https://www.prisma.io/docs/reference/tools-and-interfaces/prisma-client/raw-database-access).
   */
  $queryRawUnsafe<T = unknown>(query: string, ...values: any[]): Prisma.PrismaPromise<T>;


  /**
   * Allows the running of a sequence of read/write operations that are guaranteed to either succeed or fail as a whole.
   * @example
   * ```
   * const [george, bob, alice] = await prisma.$transaction([
   *   prisma.user.create({ data: { name: 'George' } }),
   *   prisma.user.create({ data: { name: 'Bob' } }),
   *   prisma.user.create({ data: { name: 'Alice' } }),
   * ])
   * ```
   * 
   * Read more in our [docs](https://www.prisma.io/docs/concepts/components/prisma-client/transactions).
   */
  $transaction<P extends Prisma.PrismaPromise<any>[]>(arg: [...P], options?: { isolationLevel?: Prisma.TransactionIsolationLevel }): $Utils.JsPromise<runtime.Types.Utils.UnwrapTuple<P>>

  $transaction<R>(fn: (prisma: Omit<PrismaClient, runtime.ITXClientDenyList>) => $Utils.JsPromise<R>, options?: { maxWait?: number, timeout?: number, isolationLevel?: Prisma.TransactionIsolationLevel }): $Utils.JsPromise<R>


  $extends: $Extensions.ExtendsHook<"extends", Prisma.TypeMapCb, ExtArgs>

      /**
   * `prisma.agent_lab_configs`: Exposes CRUD operations for the **agent_lab_configs** model.
    * Example usage:
    * ```ts
    * // Fetch zero or more Agent_lab_configs
    * const agent_lab_configs = await prisma.agent_lab_configs.findMany()
    * ```
    */
  get agent_lab_configs(): Prisma.agent_lab_configsDelegate<ExtArgs>;

  /**
   * `prisma.agent_model_configs`: Exposes CRUD operations for the **agent_model_configs** model.
    * Example usage:
    * ```ts
    * // Fetch zero or more Agent_model_configs
    * const agent_model_configs = await prisma.agent_model_configs.findMany()
    * ```
    */
  get agent_model_configs(): Prisma.agent_model_configsDelegate<ExtArgs>;

  /**
   * `prisma.agent_prompts`: Exposes CRUD operations for the **agent_prompts** model.
    * Example usage:
    * ```ts
    * // Fetch zero or more Agent_prompts
    * const agent_prompts = await prisma.agent_prompts.findMany()
    * ```
    */
  get agent_prompts(): Prisma.agent_promptsDelegate<ExtArgs>;

  /**
   * `prisma.agent_definitions`: Exposes CRUD operations for the **agent_definitions** model.
    * Example usage:
    * ```ts
    * // Fetch zero or more Agent_definitions
    * const agent_definitions = await prisma.agent_definitions.findMany()
    * ```
    */
  get agent_definitions(): Prisma.agent_definitionsDelegate<ExtArgs>;

  /**
   * `prisma.orchestrator_definitions`: Exposes CRUD operations for the **orchestrator_definitions** model.
    * Example usage:
    * ```ts
    * // Fetch zero or more Orchestrator_definitions
    * const orchestrator_definitions = await prisma.orchestrator_definitions.findMany()
    * ```
    */
  get orchestrator_definitions(): Prisma.orchestrator_definitionsDelegate<ExtArgs>;

  /**
   * `prisma.agent_registrations`: Exposes CRUD operations for the **agent_registrations** model.
    * Example usage:
    * ```ts
    * // Fetch zero or more Agent_registrations
    * const agent_registrations = await prisma.agent_registrations.findMany()
    * ```
    */
  get agent_registrations(): Prisma.agent_registrationsDelegate<ExtArgs>;

  /**
   * `prisma.platform_api_configs`: Exposes CRUD operations for the **platform_api_configs** model.
    * Example usage:
    * ```ts
    * // Fetch zero or more Platform_api_configs
    * const platform_api_configs = await prisma.platform_api_configs.findMany()
    * ```
    */
  get platform_api_configs(): Prisma.platform_api_configsDelegate<ExtArgs>;

  /**
   * `prisma.platform_settings`: Exposes CRUD operations for the **platform_settings** model.
    * Example usage:
    * ```ts
    * // Fetch zero or more Platform_settings
    * const platform_settings = await prisma.platform_settings.findMany()
    * ```
    */
  get platform_settings(): Prisma.platform_settingsDelegate<ExtArgs>;

  /**
   * `prisma.skill_model_configs`: Exposes CRUD operations for the **skill_model_configs** model.
    * Example usage:
    * ```ts
    * // Fetch zero or more Skill_model_configs
    * const skill_model_configs = await prisma.skill_model_configs.findMany()
    * ```
    */
  get skill_model_configs(): Prisma.skill_model_configsDelegate<ExtArgs>;

  /**
   * `prisma.skill_registrations`: Exposes CRUD operations for the **skill_registrations** model.
    * Example usage:
    * ```ts
    * // Fetch zero or more Skill_registrations
    * const skill_registrations = await prisma.skill_registrations.findMany()
    * ```
    */
  get skill_registrations(): Prisma.skill_registrationsDelegate<ExtArgs>;

  /**
   * `prisma.field_definitions`: Exposes CRUD operations for the **field_definitions** model.
    * Example usage:
    * ```ts
    * // Fetch zero or more Field_definitions
    * const field_definitions = await prisma.field_definitions.findMany()
    * ```
    */
  get field_definitions(): Prisma.field_definitionsDelegate<ExtArgs>;

  /**
   * `prisma.agent_contracts`: Exposes CRUD operations for the **agent_contracts** model.
    * Example usage:
    * ```ts
    * // Fetch zero or more Agent_contracts
    * const agent_contracts = await prisma.agent_contracts.findMany()
    * ```
    */
  get agent_contracts(): Prisma.agent_contractsDelegate<ExtArgs>;

  /**
   * `prisma.agent_field_routings`: Exposes CRUD operations for the **agent_field_routings** model.
    * Example usage:
    * ```ts
    * // Fetch zero or more Agent_field_routings
    * const agent_field_routings = await prisma.agent_field_routings.findMany()
    * ```
    */
  get agent_field_routings(): Prisma.agent_field_routingsDelegate<ExtArgs>;

  /**
   * `prisma.node_config_changes`: Exposes CRUD operations for the **node_config_changes** model.
    * Example usage:
    * ```ts
    * // Fetch zero or more Node_config_changes
    * const node_config_changes = await prisma.node_config_changes.findMany()
    * ```
    */
  get node_config_changes(): Prisma.node_config_changesDelegate<ExtArgs>;

  /**
   * `prisma.prompt_eval_cases`: Exposes CRUD operations for the **prompt_eval_cases** model.
    * Example usage:
    * ```ts
    * // Fetch zero or more Prompt_eval_cases
    * const prompt_eval_cases = await prisma.prompt_eval_cases.findMany()
    * ```
    */
  get prompt_eval_cases(): Prisma.prompt_eval_casesDelegate<ExtArgs>;

  /**
   * `prisma.prompt_eval_runs`: Exposes CRUD operations for the **prompt_eval_runs** model.
    * Example usage:
    * ```ts
    * // Fetch zero or more Prompt_eval_runs
    * const prompt_eval_runs = await prisma.prompt_eval_runs.findMany()
    * ```
    */
  get prompt_eval_runs(): Prisma.prompt_eval_runsDelegate<ExtArgs>;
}

export namespace Prisma {
  export import DMMF = runtime.DMMF

  export type PrismaPromise<T> = $Public.PrismaPromise<T>

  /**
   * Validator
   */
  export import validator = runtime.Public.validator

  /**
   * Prisma Errors
   */
  export import PrismaClientKnownRequestError = runtime.PrismaClientKnownRequestError
  export import PrismaClientUnknownRequestError = runtime.PrismaClientUnknownRequestError
  export import PrismaClientRustPanicError = runtime.PrismaClientRustPanicError
  export import PrismaClientInitializationError = runtime.PrismaClientInitializationError
  export import PrismaClientValidationError = runtime.PrismaClientValidationError
  export import NotFoundError = runtime.NotFoundError

  /**
   * Re-export of sql-template-tag
   */
  export import sql = runtime.sqltag
  export import empty = runtime.empty
  export import join = runtime.join
  export import raw = runtime.raw
  export import Sql = runtime.Sql



  /**
   * Decimal.js
   */
  export import Decimal = runtime.Decimal

  export type DecimalJsLike = runtime.DecimalJsLike

  /**
   * Metrics 
   */
  export type Metrics = runtime.Metrics
  export type Metric<T> = runtime.Metric<T>
  export type MetricHistogram = runtime.MetricHistogram
  export type MetricHistogramBucket = runtime.MetricHistogramBucket

  /**
  * Extensions
  */
  export import Extension = $Extensions.UserArgs
  export import getExtensionContext = runtime.Extensions.getExtensionContext
  export import Args = $Public.Args
  export import Payload = $Public.Payload
  export import Result = $Public.Result
  export import Exact = $Public.Exact

  /**
   * Prisma Client JS version: 5.22.0
   * Query Engine version: 605197351a3c8bdd595af2d2a9bc3025bca48ea2
   */
  export type PrismaVersion = {
    client: string
  }

  export const prismaVersion: PrismaVersion 

  /**
   * Utility Types
   */


  export import JsonObject = runtime.JsonObject
  export import JsonArray = runtime.JsonArray
  export import JsonValue = runtime.JsonValue
  export import InputJsonObject = runtime.InputJsonObject
  export import InputJsonArray = runtime.InputJsonArray
  export import InputJsonValue = runtime.InputJsonValue

  /**
   * Types of the values used to represent different kinds of `null` values when working with JSON fields.
   * 
   * @see https://www.prisma.io/docs/concepts/components/prisma-client/working-with-fields/working-with-json-fields#filtering-on-a-json-field
   */
  namespace NullTypes {
    /**
    * Type of `Prisma.DbNull`.
    * 
    * You cannot use other instances of this class. Please use the `Prisma.DbNull` value.
    * 
    * @see https://www.prisma.io/docs/concepts/components/prisma-client/working-with-fields/working-with-json-fields#filtering-on-a-json-field
    */
    class DbNull {
      private DbNull: never
      private constructor()
    }

    /**
    * Type of `Prisma.JsonNull`.
    * 
    * You cannot use other instances of this class. Please use the `Prisma.JsonNull` value.
    * 
    * @see https://www.prisma.io/docs/concepts/components/prisma-client/working-with-fields/working-with-json-fields#filtering-on-a-json-field
    */
    class JsonNull {
      private JsonNull: never
      private constructor()
    }

    /**
    * Type of `Prisma.AnyNull`.
    * 
    * You cannot use other instances of this class. Please use the `Prisma.AnyNull` value.
    * 
    * @see https://www.prisma.io/docs/concepts/components/prisma-client/working-with-fields/working-with-json-fields#filtering-on-a-json-field
    */
    class AnyNull {
      private AnyNull: never
      private constructor()
    }
  }

  /**
   * Helper for filtering JSON entries that have `null` on the database (empty on the db)
   * 
   * @see https://www.prisma.io/docs/concepts/components/prisma-client/working-with-fields/working-with-json-fields#filtering-on-a-json-field
   */
  export const DbNull: NullTypes.DbNull

  /**
   * Helper for filtering JSON entries that have JSON `null` values (not empty on the db)
   * 
   * @see https://www.prisma.io/docs/concepts/components/prisma-client/working-with-fields/working-with-json-fields#filtering-on-a-json-field
   */
  export const JsonNull: NullTypes.JsonNull

  /**
   * Helper for filtering JSON entries that are `Prisma.DbNull` or `Prisma.JsonNull`
   * 
   * @see https://www.prisma.io/docs/concepts/components/prisma-client/working-with-fields/working-with-json-fields#filtering-on-a-json-field
   */
  export const AnyNull: NullTypes.AnyNull

  type SelectAndInclude = {
    select: any
    include: any
  }

  type SelectAndOmit = {
    select: any
    omit: any
  }

  /**
   * Get the type of the value, that the Promise holds.
   */
  export type PromiseType<T extends PromiseLike<any>> = T extends PromiseLike<infer U> ? U : T;

  /**
   * Get the return type of a function which returns a Promise.
   */
  export type PromiseReturnType<T extends (...args: any) => $Utils.JsPromise<any>> = PromiseType<ReturnType<T>>

  /**
   * From T, pick a set of properties whose keys are in the union K
   */
  type Prisma__Pick<T, K extends keyof T> = {
      [P in K]: T[P];
  };


  export type Enumerable<T> = T | Array<T>;

  export type RequiredKeys<T> = {
    [K in keyof T]-?: {} extends Prisma__Pick<T, K> ? never : K
  }[keyof T]

  export type TruthyKeys<T> = keyof {
    [K in keyof T as T[K] extends false | undefined | null ? never : K]: K
  }

  export type TrueKeys<T> = TruthyKeys<Prisma__Pick<T, RequiredKeys<T>>>

  /**
   * Subset
   * @desc From `T` pick properties that exist in `U`. Simple version of Intersection
   */
  export type Subset<T, U> = {
    [key in keyof T]: key extends keyof U ? T[key] : never;
  };

  /**
   * SelectSubset
   * @desc From `T` pick properties that exist in `U`. Simple version of Intersection.
   * Additionally, it validates, if both select and include are present. If the case, it errors.
   */
  export type SelectSubset<T, U> = {
    [key in keyof T]: key extends keyof U ? T[key] : never
  } &
    (T extends SelectAndInclude
      ? 'Please either choose `select` or `include`.'
      : T extends SelectAndOmit
        ? 'Please either choose `select` or `omit`.'
        : {})

  /**
   * Subset + Intersection
   * @desc From `T` pick properties that exist in `U` and intersect `K`
   */
  export type SubsetIntersection<T, U, K> = {
    [key in keyof T]: key extends keyof U ? T[key] : never
  } &
    K

  type Without<T, U> = { [P in Exclude<keyof T, keyof U>]?: never };

  /**
   * XOR is needed to have a real mutually exclusive union type
   * https://stackoverflow.com/questions/42123407/does-typescript-support-mutually-exclusive-types
   */
  type XOR<T, U> =
    T extends object ?
    U extends object ?
      (Without<T, U> & U) | (Without<U, T> & T)
    : U : T


  /**
   * Is T a Record?
   */
  type IsObject<T extends any> = T extends Array<any>
  ? False
  : T extends Date
  ? False
  : T extends Uint8Array
  ? False
  : T extends BigInt
  ? False
  : T extends object
  ? True
  : False


  /**
   * If it's T[], return T
   */
  export type UnEnumerate<T extends unknown> = T extends Array<infer U> ? U : T

  /**
   * From ts-toolbelt
   */

  type __Either<O extends object, K extends Key> = Omit<O, K> &
    {
      // Merge all but K
      [P in K]: Prisma__Pick<O, P & keyof O> // With K possibilities
    }[K]

  type EitherStrict<O extends object, K extends Key> = Strict<__Either<O, K>>

  type EitherLoose<O extends object, K extends Key> = ComputeRaw<__Either<O, K>>

  type _Either<
    O extends object,
    K extends Key,
    strict extends Boolean
  > = {
    1: EitherStrict<O, K>
    0: EitherLoose<O, K>
  }[strict]

  type Either<
    O extends object,
    K extends Key,
    strict extends Boolean = 1
  > = O extends unknown ? _Either<O, K, strict> : never

  export type Union = any

  type PatchUndefined<O extends object, O1 extends object> = {
    [K in keyof O]: O[K] extends undefined ? At<O1, K> : O[K]
  } & {}

  /** Helper Types for "Merge" **/
  export type IntersectOf<U extends Union> = (
    U extends unknown ? (k: U) => void : never
  ) extends (k: infer I) => void
    ? I
    : never

  export type Overwrite<O extends object, O1 extends object> = {
      [K in keyof O]: K extends keyof O1 ? O1[K] : O[K];
  } & {};

  type _Merge<U extends object> = IntersectOf<Overwrite<U, {
      [K in keyof U]-?: At<U, K>;
  }>>;

  type Key = string | number | symbol;
  type AtBasic<O extends object, K extends Key> = K extends keyof O ? O[K] : never;
  type AtStrict<O extends object, K extends Key> = O[K & keyof O];
  type AtLoose<O extends object, K extends Key> = O extends unknown ? AtStrict<O, K> : never;
  export type At<O extends object, K extends Key, strict extends Boolean = 1> = {
      1: AtStrict<O, K>;
      0: AtLoose<O, K>;
  }[strict];

  export type ComputeRaw<A extends any> = A extends Function ? A : {
    [K in keyof A]: A[K];
  } & {};

  export type OptionalFlat<O> = {
    [K in keyof O]?: O[K];
  } & {};

  type _Record<K extends keyof any, T> = {
    [P in K]: T;
  };

  // cause typescript not to expand types and preserve names
  type NoExpand<T> = T extends unknown ? T : never;

  // this type assumes the passed object is entirely optional
  type AtLeast<O extends object, K extends string> = NoExpand<
    O extends unknown
    ? | (K extends keyof O ? { [P in K]: O[P] } & O : O)
      | {[P in keyof O as P extends K ? K : never]-?: O[P]} & O
    : never>;

  type _Strict<U, _U = U> = U extends unknown ? U & OptionalFlat<_Record<Exclude<Keys<_U>, keyof U>, never>> : never;

  export type Strict<U extends object> = ComputeRaw<_Strict<U>>;
  /** End Helper Types for "Merge" **/

  export type Merge<U extends object> = ComputeRaw<_Merge<Strict<U>>>;

  /**
  A [[Boolean]]
  */
  export type Boolean = True | False

  // /**
  // 1
  // */
  export type True = 1

  /**
  0
  */
  export type False = 0

  export type Not<B extends Boolean> = {
    0: 1
    1: 0
  }[B]

  export type Extends<A1 extends any, A2 extends any> = [A1] extends [never]
    ? 0 // anything `never` is false
    : A1 extends A2
    ? 1
    : 0

  export type Has<U extends Union, U1 extends Union> = Not<
    Extends<Exclude<U1, U>, U1>
  >

  export type Or<B1 extends Boolean, B2 extends Boolean> = {
    0: {
      0: 0
      1: 1
    }
    1: {
      0: 1
      1: 1
    }
  }[B1][B2]

  export type Keys<U extends Union> = U extends unknown ? keyof U : never

  type Cast<A, B> = A extends B ? A : B;

  export const type: unique symbol;



  /**
   * Used by group by
   */

  export type GetScalarType<T, O> = O extends object ? {
    [P in keyof T]: P extends keyof O
      ? O[P]
      : never
  } : never

  type FieldPaths<
    T,
    U = Omit<T, '_avg' | '_sum' | '_count' | '_min' | '_max'>
  > = IsObject<T> extends True ? U : T

  type GetHavingFields<T> = {
    [K in keyof T]: Or<
      Or<Extends<'OR', K>, Extends<'AND', K>>,
      Extends<'NOT', K>
    > extends True
      ? // infer is only needed to not hit TS limit
        // based on the brilliant idea of Pierre-Antoine Mills
        // https://github.com/microsoft/TypeScript/issues/30188#issuecomment-478938437
        T[K] extends infer TK
        ? GetHavingFields<UnEnumerate<TK> extends object ? Merge<UnEnumerate<TK>> : never>
        : never
      : {} extends FieldPaths<T[K]>
      ? never
      : K
  }[keyof T]

  /**
   * Convert tuple to union
   */
  type _TupleToUnion<T> = T extends (infer E)[] ? E : never
  type TupleToUnion<K extends readonly any[]> = _TupleToUnion<K>
  type MaybeTupleToUnion<T> = T extends any[] ? TupleToUnion<T> : T

  /**
   * Like `Pick`, but additionally can also accept an array of keys
   */
  type PickEnumerable<T, K extends Enumerable<keyof T> | keyof T> = Prisma__Pick<T, MaybeTupleToUnion<K>>

  /**
   * Exclude all keys with underscores
   */
  type ExcludeUnderscoreKeys<T extends string> = T extends `_${string}` ? never : T


  export type FieldRef<Model, FieldType> = runtime.FieldRef<Model, FieldType>

  type FieldRefInputType<Model, FieldType> = Model extends never ? never : FieldRef<Model, FieldType>


  export const ModelName: {
    agent_lab_configs: 'agent_lab_configs',
    agent_model_configs: 'agent_model_configs',
    agent_prompts: 'agent_prompts',
    agent_definitions: 'agent_definitions',
    orchestrator_definitions: 'orchestrator_definitions',
    agent_registrations: 'agent_registrations',
    platform_api_configs: 'platform_api_configs',
    platform_settings: 'platform_settings',
    skill_model_configs: 'skill_model_configs',
    skill_registrations: 'skill_registrations',
    field_definitions: 'field_definitions',
    agent_contracts: 'agent_contracts',
    agent_field_routings: 'agent_field_routings',
    node_config_changes: 'node_config_changes',
    prompt_eval_cases: 'prompt_eval_cases',
    prompt_eval_runs: 'prompt_eval_runs'
  };

  export type ModelName = (typeof ModelName)[keyof typeof ModelName]


  export type Datasources = {
    db?: Datasource
  }

  interface TypeMapCb extends $Utils.Fn<{extArgs: $Extensions.InternalArgs, clientOptions: PrismaClientOptions }, $Utils.Record<string, any>> {
    returns: Prisma.TypeMap<this['params']['extArgs'], this['params']['clientOptions']>
  }

  export type TypeMap<ExtArgs extends $Extensions.InternalArgs = $Extensions.DefaultArgs, ClientOptions = {}> = {
    meta: {
      modelProps: "agent_lab_configs" | "agent_model_configs" | "agent_prompts" | "agent_definitions" | "orchestrator_definitions" | "agent_registrations" | "platform_api_configs" | "platform_settings" | "skill_model_configs" | "skill_registrations" | "field_definitions" | "agent_contracts" | "agent_field_routings" | "node_config_changes" | "prompt_eval_cases" | "prompt_eval_runs"
      txIsolationLevel: Prisma.TransactionIsolationLevel
    }
    model: {
      agent_lab_configs: {
        payload: Prisma.$agent_lab_configsPayload<ExtArgs>
        fields: Prisma.agent_lab_configsFieldRefs
        operations: {
          findUnique: {
            args: Prisma.agent_lab_configsFindUniqueArgs<ExtArgs>
            result: $Utils.PayloadToResult<Prisma.$agent_lab_configsPayload> | null
          }
          findUniqueOrThrow: {
            args: Prisma.agent_lab_configsFindUniqueOrThrowArgs<ExtArgs>
            result: $Utils.PayloadToResult<Prisma.$agent_lab_configsPayload>
          }
          findFirst: {
            args: Prisma.agent_lab_configsFindFirstArgs<ExtArgs>
            result: $Utils.PayloadToResult<Prisma.$agent_lab_configsPayload> | null
          }
          findFirstOrThrow: {
            args: Prisma.agent_lab_configsFindFirstOrThrowArgs<ExtArgs>
            result: $Utils.PayloadToResult<Prisma.$agent_lab_configsPayload>
          }
          findMany: {
            args: Prisma.agent_lab_configsFindManyArgs<ExtArgs>
            result: $Utils.PayloadToResult<Prisma.$agent_lab_configsPayload>[]
          }
          create: {
            args: Prisma.agent_lab_configsCreateArgs<ExtArgs>
            result: $Utils.PayloadToResult<Prisma.$agent_lab_configsPayload>
          }
          createMany: {
            args: Prisma.agent_lab_configsCreateManyArgs<ExtArgs>
            result: BatchPayload
          }
          createManyAndReturn: {
            args: Prisma.agent_lab_configsCreateManyAndReturnArgs<ExtArgs>
            result: $Utils.PayloadToResult<Prisma.$agent_lab_configsPayload>[]
          }
          delete: {
            args: Prisma.agent_lab_configsDeleteArgs<ExtArgs>
            result: $Utils.PayloadToResult<Prisma.$agent_lab_configsPayload>
          }
          update: {
            args: Prisma.agent_lab_configsUpdateArgs<ExtArgs>
            result: $Utils.PayloadToResult<Prisma.$agent_lab_configsPayload>
          }
          deleteMany: {
            args: Prisma.agent_lab_configsDeleteManyArgs<ExtArgs>
            result: BatchPayload
          }
          updateMany: {
            args: Prisma.agent_lab_configsUpdateManyArgs<ExtArgs>
            result: BatchPayload
          }
          upsert: {
            args: Prisma.agent_lab_configsUpsertArgs<ExtArgs>
            result: $Utils.PayloadToResult<Prisma.$agent_lab_configsPayload>
          }
          aggregate: {
            args: Prisma.Agent_lab_configsAggregateArgs<ExtArgs>
            result: $Utils.Optional<AggregateAgent_lab_configs>
          }
          groupBy: {
            args: Prisma.agent_lab_configsGroupByArgs<ExtArgs>
            result: $Utils.Optional<Agent_lab_configsGroupByOutputType>[]
          }
          count: {
            args: Prisma.agent_lab_configsCountArgs<ExtArgs>
            result: $Utils.Optional<Agent_lab_configsCountAggregateOutputType> | number
          }
        }
      }
      agent_model_configs: {
        payload: Prisma.$agent_model_configsPayload<ExtArgs>
        fields: Prisma.agent_model_configsFieldRefs
        operations: {
          findUnique: {
            args: Prisma.agent_model_configsFindUniqueArgs<ExtArgs>
            result: $Utils.PayloadToResult<Prisma.$agent_model_configsPayload> | null
          }
          findUniqueOrThrow: {
            args: Prisma.agent_model_configsFindUniqueOrThrowArgs<ExtArgs>
            result: $Utils.PayloadToResult<Prisma.$agent_model_configsPayload>
          }
          findFirst: {
            args: Prisma.agent_model_configsFindFirstArgs<ExtArgs>
            result: $Utils.PayloadToResult<Prisma.$agent_model_configsPayload> | null
          }
          findFirstOrThrow: {
            args: Prisma.agent_model_configsFindFirstOrThrowArgs<ExtArgs>
            result: $Utils.PayloadToResult<Prisma.$agent_model_configsPayload>
          }
          findMany: {
            args: Prisma.agent_model_configsFindManyArgs<ExtArgs>
            result: $Utils.PayloadToResult<Prisma.$agent_model_configsPayload>[]
          }
          create: {
            args: Prisma.agent_model_configsCreateArgs<ExtArgs>
            result: $Utils.PayloadToResult<Prisma.$agent_model_configsPayload>
          }
          createMany: {
            args: Prisma.agent_model_configsCreateManyArgs<ExtArgs>
            result: BatchPayload
          }
          createManyAndReturn: {
            args: Prisma.agent_model_configsCreateManyAndReturnArgs<ExtArgs>
            result: $Utils.PayloadToResult<Prisma.$agent_model_configsPayload>[]
          }
          delete: {
            args: Prisma.agent_model_configsDeleteArgs<ExtArgs>
            result: $Utils.PayloadToResult<Prisma.$agent_model_configsPayload>
          }
          update: {
            args: Prisma.agent_model_configsUpdateArgs<ExtArgs>
            result: $Utils.PayloadToResult<Prisma.$agent_model_configsPayload>
          }
          deleteMany: {
            args: Prisma.agent_model_configsDeleteManyArgs<ExtArgs>
            result: BatchPayload
          }
          updateMany: {
            args: Prisma.agent_model_configsUpdateManyArgs<ExtArgs>
            result: BatchPayload
          }
          upsert: {
            args: Prisma.agent_model_configsUpsertArgs<ExtArgs>
            result: $Utils.PayloadToResult<Prisma.$agent_model_configsPayload>
          }
          aggregate: {
            args: Prisma.Agent_model_configsAggregateArgs<ExtArgs>
            result: $Utils.Optional<AggregateAgent_model_configs>
          }
          groupBy: {
            args: Prisma.agent_model_configsGroupByArgs<ExtArgs>
            result: $Utils.Optional<Agent_model_configsGroupByOutputType>[]
          }
          count: {
            args: Prisma.agent_model_configsCountArgs<ExtArgs>
            result: $Utils.Optional<Agent_model_configsCountAggregateOutputType> | number
          }
        }
      }
      agent_prompts: {
        payload: Prisma.$agent_promptsPayload<ExtArgs>
        fields: Prisma.agent_promptsFieldRefs
        operations: {
          findUnique: {
            args: Prisma.agent_promptsFindUniqueArgs<ExtArgs>
            result: $Utils.PayloadToResult<Prisma.$agent_promptsPayload> | null
          }
          findUniqueOrThrow: {
            args: Prisma.agent_promptsFindUniqueOrThrowArgs<ExtArgs>
            result: $Utils.PayloadToResult<Prisma.$agent_promptsPayload>
          }
          findFirst: {
            args: Prisma.agent_promptsFindFirstArgs<ExtArgs>
            result: $Utils.PayloadToResult<Prisma.$agent_promptsPayload> | null
          }
          findFirstOrThrow: {
            args: Prisma.agent_promptsFindFirstOrThrowArgs<ExtArgs>
            result: $Utils.PayloadToResult<Prisma.$agent_promptsPayload>
          }
          findMany: {
            args: Prisma.agent_promptsFindManyArgs<ExtArgs>
            result: $Utils.PayloadToResult<Prisma.$agent_promptsPayload>[]
          }
          create: {
            args: Prisma.agent_promptsCreateArgs<ExtArgs>
            result: $Utils.PayloadToResult<Prisma.$agent_promptsPayload>
          }
          createMany: {
            args: Prisma.agent_promptsCreateManyArgs<ExtArgs>
            result: BatchPayload
          }
          createManyAndReturn: {
            args: Prisma.agent_promptsCreateManyAndReturnArgs<ExtArgs>
            result: $Utils.PayloadToResult<Prisma.$agent_promptsPayload>[]
          }
          delete: {
            args: Prisma.agent_promptsDeleteArgs<ExtArgs>
            result: $Utils.PayloadToResult<Prisma.$agent_promptsPayload>
          }
          update: {
            args: Prisma.agent_promptsUpdateArgs<ExtArgs>
            result: $Utils.PayloadToResult<Prisma.$agent_promptsPayload>
          }
          deleteMany: {
            args: Prisma.agent_promptsDeleteManyArgs<ExtArgs>
            result: BatchPayload
          }
          updateMany: {
            args: Prisma.agent_promptsUpdateManyArgs<ExtArgs>
            result: BatchPayload
          }
          upsert: {
            args: Prisma.agent_promptsUpsertArgs<ExtArgs>
            result: $Utils.PayloadToResult<Prisma.$agent_promptsPayload>
          }
          aggregate: {
            args: Prisma.Agent_promptsAggregateArgs<ExtArgs>
            result: $Utils.Optional<AggregateAgent_prompts>
          }
          groupBy: {
            args: Prisma.agent_promptsGroupByArgs<ExtArgs>
            result: $Utils.Optional<Agent_promptsGroupByOutputType>[]
          }
          count: {
            args: Prisma.agent_promptsCountArgs<ExtArgs>
            result: $Utils.Optional<Agent_promptsCountAggregateOutputType> | number
          }
        }
      }
      agent_definitions: {
        payload: Prisma.$agent_definitionsPayload<ExtArgs>
        fields: Prisma.agent_definitionsFieldRefs
        operations: {
          findUnique: {
            args: Prisma.agent_definitionsFindUniqueArgs<ExtArgs>
            result: $Utils.PayloadToResult<Prisma.$agent_definitionsPayload> | null
          }
          findUniqueOrThrow: {
            args: Prisma.agent_definitionsFindUniqueOrThrowArgs<ExtArgs>
            result: $Utils.PayloadToResult<Prisma.$agent_definitionsPayload>
          }
          findFirst: {
            args: Prisma.agent_definitionsFindFirstArgs<ExtArgs>
            result: $Utils.PayloadToResult<Prisma.$agent_definitionsPayload> | null
          }
          findFirstOrThrow: {
            args: Prisma.agent_definitionsFindFirstOrThrowArgs<ExtArgs>
            result: $Utils.PayloadToResult<Prisma.$agent_definitionsPayload>
          }
          findMany: {
            args: Prisma.agent_definitionsFindManyArgs<ExtArgs>
            result: $Utils.PayloadToResult<Prisma.$agent_definitionsPayload>[]
          }
          create: {
            args: Prisma.agent_definitionsCreateArgs<ExtArgs>
            result: $Utils.PayloadToResult<Prisma.$agent_definitionsPayload>
          }
          createMany: {
            args: Prisma.agent_definitionsCreateManyArgs<ExtArgs>
            result: BatchPayload
          }
          createManyAndReturn: {
            args: Prisma.agent_definitionsCreateManyAndReturnArgs<ExtArgs>
            result: $Utils.PayloadToResult<Prisma.$agent_definitionsPayload>[]
          }
          delete: {
            args: Prisma.agent_definitionsDeleteArgs<ExtArgs>
            result: $Utils.PayloadToResult<Prisma.$agent_definitionsPayload>
          }
          update: {
            args: Prisma.agent_definitionsUpdateArgs<ExtArgs>
            result: $Utils.PayloadToResult<Prisma.$agent_definitionsPayload>
          }
          deleteMany: {
            args: Prisma.agent_definitionsDeleteManyArgs<ExtArgs>
            result: BatchPayload
          }
          updateMany: {
            args: Prisma.agent_definitionsUpdateManyArgs<ExtArgs>
            result: BatchPayload
          }
          upsert: {
            args: Prisma.agent_definitionsUpsertArgs<ExtArgs>
            result: $Utils.PayloadToResult<Prisma.$agent_definitionsPayload>
          }
          aggregate: {
            args: Prisma.Agent_definitionsAggregateArgs<ExtArgs>
            result: $Utils.Optional<AggregateAgent_definitions>
          }
          groupBy: {
            args: Prisma.agent_definitionsGroupByArgs<ExtArgs>
            result: $Utils.Optional<Agent_definitionsGroupByOutputType>[]
          }
          count: {
            args: Prisma.agent_definitionsCountArgs<ExtArgs>
            result: $Utils.Optional<Agent_definitionsCountAggregateOutputType> | number
          }
        }
      }
      orchestrator_definitions: {
        payload: Prisma.$orchestrator_definitionsPayload<ExtArgs>
        fields: Prisma.orchestrator_definitionsFieldRefs
        operations: {
          findUnique: {
            args: Prisma.orchestrator_definitionsFindUniqueArgs<ExtArgs>
            result: $Utils.PayloadToResult<Prisma.$orchestrator_definitionsPayload> | null
          }
          findUniqueOrThrow: {
            args: Prisma.orchestrator_definitionsFindUniqueOrThrowArgs<ExtArgs>
            result: $Utils.PayloadToResult<Prisma.$orchestrator_definitionsPayload>
          }
          findFirst: {
            args: Prisma.orchestrator_definitionsFindFirstArgs<ExtArgs>
            result: $Utils.PayloadToResult<Prisma.$orchestrator_definitionsPayload> | null
          }
          findFirstOrThrow: {
            args: Prisma.orchestrator_definitionsFindFirstOrThrowArgs<ExtArgs>
            result: $Utils.PayloadToResult<Prisma.$orchestrator_definitionsPayload>
          }
          findMany: {
            args: Prisma.orchestrator_definitionsFindManyArgs<ExtArgs>
            result: $Utils.PayloadToResult<Prisma.$orchestrator_definitionsPayload>[]
          }
          create: {
            args: Prisma.orchestrator_definitionsCreateArgs<ExtArgs>
            result: $Utils.PayloadToResult<Prisma.$orchestrator_definitionsPayload>
          }
          createMany: {
            args: Prisma.orchestrator_definitionsCreateManyArgs<ExtArgs>
            result: BatchPayload
          }
          createManyAndReturn: {
            args: Prisma.orchestrator_definitionsCreateManyAndReturnArgs<ExtArgs>
            result: $Utils.PayloadToResult<Prisma.$orchestrator_definitionsPayload>[]
          }
          delete: {
            args: Prisma.orchestrator_definitionsDeleteArgs<ExtArgs>
            result: $Utils.PayloadToResult<Prisma.$orchestrator_definitionsPayload>
          }
          update: {
            args: Prisma.orchestrator_definitionsUpdateArgs<ExtArgs>
            result: $Utils.PayloadToResult<Prisma.$orchestrator_definitionsPayload>
          }
          deleteMany: {
            args: Prisma.orchestrator_definitionsDeleteManyArgs<ExtArgs>
            result: BatchPayload
          }
          updateMany: {
            args: Prisma.orchestrator_definitionsUpdateManyArgs<ExtArgs>
            result: BatchPayload
          }
          upsert: {
            args: Prisma.orchestrator_definitionsUpsertArgs<ExtArgs>
            result: $Utils.PayloadToResult<Prisma.$orchestrator_definitionsPayload>
          }
          aggregate: {
            args: Prisma.Orchestrator_definitionsAggregateArgs<ExtArgs>
            result: $Utils.Optional<AggregateOrchestrator_definitions>
          }
          groupBy: {
            args: Prisma.orchestrator_definitionsGroupByArgs<ExtArgs>
            result: $Utils.Optional<Orchestrator_definitionsGroupByOutputType>[]
          }
          count: {
            args: Prisma.orchestrator_definitionsCountArgs<ExtArgs>
            result: $Utils.Optional<Orchestrator_definitionsCountAggregateOutputType> | number
          }
        }
      }
      agent_registrations: {
        payload: Prisma.$agent_registrationsPayload<ExtArgs>
        fields: Prisma.agent_registrationsFieldRefs
        operations: {
          findUnique: {
            args: Prisma.agent_registrationsFindUniqueArgs<ExtArgs>
            result: $Utils.PayloadToResult<Prisma.$agent_registrationsPayload> | null
          }
          findUniqueOrThrow: {
            args: Prisma.agent_registrationsFindUniqueOrThrowArgs<ExtArgs>
            result: $Utils.PayloadToResult<Prisma.$agent_registrationsPayload>
          }
          findFirst: {
            args: Prisma.agent_registrationsFindFirstArgs<ExtArgs>
            result: $Utils.PayloadToResult<Prisma.$agent_registrationsPayload> | null
          }
          findFirstOrThrow: {
            args: Prisma.agent_registrationsFindFirstOrThrowArgs<ExtArgs>
            result: $Utils.PayloadToResult<Prisma.$agent_registrationsPayload>
          }
          findMany: {
            args: Prisma.agent_registrationsFindManyArgs<ExtArgs>
            result: $Utils.PayloadToResult<Prisma.$agent_registrationsPayload>[]
          }
          create: {
            args: Prisma.agent_registrationsCreateArgs<ExtArgs>
            result: $Utils.PayloadToResult<Prisma.$agent_registrationsPayload>
          }
          createMany: {
            args: Prisma.agent_registrationsCreateManyArgs<ExtArgs>
            result: BatchPayload
          }
          createManyAndReturn: {
            args: Prisma.agent_registrationsCreateManyAndReturnArgs<ExtArgs>
            result: $Utils.PayloadToResult<Prisma.$agent_registrationsPayload>[]
          }
          delete: {
            args: Prisma.agent_registrationsDeleteArgs<ExtArgs>
            result: $Utils.PayloadToResult<Prisma.$agent_registrationsPayload>
          }
          update: {
            args: Prisma.agent_registrationsUpdateArgs<ExtArgs>
            result: $Utils.PayloadToResult<Prisma.$agent_registrationsPayload>
          }
          deleteMany: {
            args: Prisma.agent_registrationsDeleteManyArgs<ExtArgs>
            result: BatchPayload
          }
          updateMany: {
            args: Prisma.agent_registrationsUpdateManyArgs<ExtArgs>
            result: BatchPayload
          }
          upsert: {
            args: Prisma.agent_registrationsUpsertArgs<ExtArgs>
            result: $Utils.PayloadToResult<Prisma.$agent_registrationsPayload>
          }
          aggregate: {
            args: Prisma.Agent_registrationsAggregateArgs<ExtArgs>
            result: $Utils.Optional<AggregateAgent_registrations>
          }
          groupBy: {
            args: Prisma.agent_registrationsGroupByArgs<ExtArgs>
            result: $Utils.Optional<Agent_registrationsGroupByOutputType>[]
          }
          count: {
            args: Prisma.agent_registrationsCountArgs<ExtArgs>
            result: $Utils.Optional<Agent_registrationsCountAggregateOutputType> | number
          }
        }
      }
      platform_api_configs: {
        payload: Prisma.$platform_api_configsPayload<ExtArgs>
        fields: Prisma.platform_api_configsFieldRefs
        operations: {
          findUnique: {
            args: Prisma.platform_api_configsFindUniqueArgs<ExtArgs>
            result: $Utils.PayloadToResult<Prisma.$platform_api_configsPayload> | null
          }
          findUniqueOrThrow: {
            args: Prisma.platform_api_configsFindUniqueOrThrowArgs<ExtArgs>
            result: $Utils.PayloadToResult<Prisma.$platform_api_configsPayload>
          }
          findFirst: {
            args: Prisma.platform_api_configsFindFirstArgs<ExtArgs>
            result: $Utils.PayloadToResult<Prisma.$platform_api_configsPayload> | null
          }
          findFirstOrThrow: {
            args: Prisma.platform_api_configsFindFirstOrThrowArgs<ExtArgs>
            result: $Utils.PayloadToResult<Prisma.$platform_api_configsPayload>
          }
          findMany: {
            args: Prisma.platform_api_configsFindManyArgs<ExtArgs>
            result: $Utils.PayloadToResult<Prisma.$platform_api_configsPayload>[]
          }
          create: {
            args: Prisma.platform_api_configsCreateArgs<ExtArgs>
            result: $Utils.PayloadToResult<Prisma.$platform_api_configsPayload>
          }
          createMany: {
            args: Prisma.platform_api_configsCreateManyArgs<ExtArgs>
            result: BatchPayload
          }
          createManyAndReturn: {
            args: Prisma.platform_api_configsCreateManyAndReturnArgs<ExtArgs>
            result: $Utils.PayloadToResult<Prisma.$platform_api_configsPayload>[]
          }
          delete: {
            args: Prisma.platform_api_configsDeleteArgs<ExtArgs>
            result: $Utils.PayloadToResult<Prisma.$platform_api_configsPayload>
          }
          update: {
            args: Prisma.platform_api_configsUpdateArgs<ExtArgs>
            result: $Utils.PayloadToResult<Prisma.$platform_api_configsPayload>
          }
          deleteMany: {
            args: Prisma.platform_api_configsDeleteManyArgs<ExtArgs>
            result: BatchPayload
          }
          updateMany: {
            args: Prisma.platform_api_configsUpdateManyArgs<ExtArgs>
            result: BatchPayload
          }
          upsert: {
            args: Prisma.platform_api_configsUpsertArgs<ExtArgs>
            result: $Utils.PayloadToResult<Prisma.$platform_api_configsPayload>
          }
          aggregate: {
            args: Prisma.Platform_api_configsAggregateArgs<ExtArgs>
            result: $Utils.Optional<AggregatePlatform_api_configs>
          }
          groupBy: {
            args: Prisma.platform_api_configsGroupByArgs<ExtArgs>
            result: $Utils.Optional<Platform_api_configsGroupByOutputType>[]
          }
          count: {
            args: Prisma.platform_api_configsCountArgs<ExtArgs>
            result: $Utils.Optional<Platform_api_configsCountAggregateOutputType> | number
          }
        }
      }
      platform_settings: {
        payload: Prisma.$platform_settingsPayload<ExtArgs>
        fields: Prisma.platform_settingsFieldRefs
        operations: {
          findUnique: {
            args: Prisma.platform_settingsFindUniqueArgs<ExtArgs>
            result: $Utils.PayloadToResult<Prisma.$platform_settingsPayload> | null
          }
          findUniqueOrThrow: {
            args: Prisma.platform_settingsFindUniqueOrThrowArgs<ExtArgs>
            result: $Utils.PayloadToResult<Prisma.$platform_settingsPayload>
          }
          findFirst: {
            args: Prisma.platform_settingsFindFirstArgs<ExtArgs>
            result: $Utils.PayloadToResult<Prisma.$platform_settingsPayload> | null
          }
          findFirstOrThrow: {
            args: Prisma.platform_settingsFindFirstOrThrowArgs<ExtArgs>
            result: $Utils.PayloadToResult<Prisma.$platform_settingsPayload>
          }
          findMany: {
            args: Prisma.platform_settingsFindManyArgs<ExtArgs>
            result: $Utils.PayloadToResult<Prisma.$platform_settingsPayload>[]
          }
          create: {
            args: Prisma.platform_settingsCreateArgs<ExtArgs>
            result: $Utils.PayloadToResult<Prisma.$platform_settingsPayload>
          }
          createMany: {
            args: Prisma.platform_settingsCreateManyArgs<ExtArgs>
            result: BatchPayload
          }
          createManyAndReturn: {
            args: Prisma.platform_settingsCreateManyAndReturnArgs<ExtArgs>
            result: $Utils.PayloadToResult<Prisma.$platform_settingsPayload>[]
          }
          delete: {
            args: Prisma.platform_settingsDeleteArgs<ExtArgs>
            result: $Utils.PayloadToResult<Prisma.$platform_settingsPayload>
          }
          update: {
            args: Prisma.platform_settingsUpdateArgs<ExtArgs>
            result: $Utils.PayloadToResult<Prisma.$platform_settingsPayload>
          }
          deleteMany: {
            args: Prisma.platform_settingsDeleteManyArgs<ExtArgs>
            result: BatchPayload
          }
          updateMany: {
            args: Prisma.platform_settingsUpdateManyArgs<ExtArgs>
            result: BatchPayload
          }
          upsert: {
            args: Prisma.platform_settingsUpsertArgs<ExtArgs>
            result: $Utils.PayloadToResult<Prisma.$platform_settingsPayload>
          }
          aggregate: {
            args: Prisma.Platform_settingsAggregateArgs<ExtArgs>
            result: $Utils.Optional<AggregatePlatform_settings>
          }
          groupBy: {
            args: Prisma.platform_settingsGroupByArgs<ExtArgs>
            result: $Utils.Optional<Platform_settingsGroupByOutputType>[]
          }
          count: {
            args: Prisma.platform_settingsCountArgs<ExtArgs>
            result: $Utils.Optional<Platform_settingsCountAggregateOutputType> | number
          }
        }
      }
      skill_model_configs: {
        payload: Prisma.$skill_model_configsPayload<ExtArgs>
        fields: Prisma.skill_model_configsFieldRefs
        operations: {
          findUnique: {
            args: Prisma.skill_model_configsFindUniqueArgs<ExtArgs>
            result: $Utils.PayloadToResult<Prisma.$skill_model_configsPayload> | null
          }
          findUniqueOrThrow: {
            args: Prisma.skill_model_configsFindUniqueOrThrowArgs<ExtArgs>
            result: $Utils.PayloadToResult<Prisma.$skill_model_configsPayload>
          }
          findFirst: {
            args: Prisma.skill_model_configsFindFirstArgs<ExtArgs>
            result: $Utils.PayloadToResult<Prisma.$skill_model_configsPayload> | null
          }
          findFirstOrThrow: {
            args: Prisma.skill_model_configsFindFirstOrThrowArgs<ExtArgs>
            result: $Utils.PayloadToResult<Prisma.$skill_model_configsPayload>
          }
          findMany: {
            args: Prisma.skill_model_configsFindManyArgs<ExtArgs>
            result: $Utils.PayloadToResult<Prisma.$skill_model_configsPayload>[]
          }
          create: {
            args: Prisma.skill_model_configsCreateArgs<ExtArgs>
            result: $Utils.PayloadToResult<Prisma.$skill_model_configsPayload>
          }
          createMany: {
            args: Prisma.skill_model_configsCreateManyArgs<ExtArgs>
            result: BatchPayload
          }
          createManyAndReturn: {
            args: Prisma.skill_model_configsCreateManyAndReturnArgs<ExtArgs>
            result: $Utils.PayloadToResult<Prisma.$skill_model_configsPayload>[]
          }
          delete: {
            args: Prisma.skill_model_configsDeleteArgs<ExtArgs>
            result: $Utils.PayloadToResult<Prisma.$skill_model_configsPayload>
          }
          update: {
            args: Prisma.skill_model_configsUpdateArgs<ExtArgs>
            result: $Utils.PayloadToResult<Prisma.$skill_model_configsPayload>
          }
          deleteMany: {
            args: Prisma.skill_model_configsDeleteManyArgs<ExtArgs>
            result: BatchPayload
          }
          updateMany: {
            args: Prisma.skill_model_configsUpdateManyArgs<ExtArgs>
            result: BatchPayload
          }
          upsert: {
            args: Prisma.skill_model_configsUpsertArgs<ExtArgs>
            result: $Utils.PayloadToResult<Prisma.$skill_model_configsPayload>
          }
          aggregate: {
            args: Prisma.Skill_model_configsAggregateArgs<ExtArgs>
            result: $Utils.Optional<AggregateSkill_model_configs>
          }
          groupBy: {
            args: Prisma.skill_model_configsGroupByArgs<ExtArgs>
            result: $Utils.Optional<Skill_model_configsGroupByOutputType>[]
          }
          count: {
            args: Prisma.skill_model_configsCountArgs<ExtArgs>
            result: $Utils.Optional<Skill_model_configsCountAggregateOutputType> | number
          }
        }
      }
      skill_registrations: {
        payload: Prisma.$skill_registrationsPayload<ExtArgs>
        fields: Prisma.skill_registrationsFieldRefs
        operations: {
          findUnique: {
            args: Prisma.skill_registrationsFindUniqueArgs<ExtArgs>
            result: $Utils.PayloadToResult<Prisma.$skill_registrationsPayload> | null
          }
          findUniqueOrThrow: {
            args: Prisma.skill_registrationsFindUniqueOrThrowArgs<ExtArgs>
            result: $Utils.PayloadToResult<Prisma.$skill_registrationsPayload>
          }
          findFirst: {
            args: Prisma.skill_registrationsFindFirstArgs<ExtArgs>
            result: $Utils.PayloadToResult<Prisma.$skill_registrationsPayload> | null
          }
          findFirstOrThrow: {
            args: Prisma.skill_registrationsFindFirstOrThrowArgs<ExtArgs>
            result: $Utils.PayloadToResult<Prisma.$skill_registrationsPayload>
          }
          findMany: {
            args: Prisma.skill_registrationsFindManyArgs<ExtArgs>
            result: $Utils.PayloadToResult<Prisma.$skill_registrationsPayload>[]
          }
          create: {
            args: Prisma.skill_registrationsCreateArgs<ExtArgs>
            result: $Utils.PayloadToResult<Prisma.$skill_registrationsPayload>
          }
          createMany: {
            args: Prisma.skill_registrationsCreateManyArgs<ExtArgs>
            result: BatchPayload
          }
          createManyAndReturn: {
            args: Prisma.skill_registrationsCreateManyAndReturnArgs<ExtArgs>
            result: $Utils.PayloadToResult<Prisma.$skill_registrationsPayload>[]
          }
          delete: {
            args: Prisma.skill_registrationsDeleteArgs<ExtArgs>
            result: $Utils.PayloadToResult<Prisma.$skill_registrationsPayload>
          }
          update: {
            args: Prisma.skill_registrationsUpdateArgs<ExtArgs>
            result: $Utils.PayloadToResult<Prisma.$skill_registrationsPayload>
          }
          deleteMany: {
            args: Prisma.skill_registrationsDeleteManyArgs<ExtArgs>
            result: BatchPayload
          }
          updateMany: {
            args: Prisma.skill_registrationsUpdateManyArgs<ExtArgs>
            result: BatchPayload
          }
          upsert: {
            args: Prisma.skill_registrationsUpsertArgs<ExtArgs>
            result: $Utils.PayloadToResult<Prisma.$skill_registrationsPayload>
          }
          aggregate: {
            args: Prisma.Skill_registrationsAggregateArgs<ExtArgs>
            result: $Utils.Optional<AggregateSkill_registrations>
          }
          groupBy: {
            args: Prisma.skill_registrationsGroupByArgs<ExtArgs>
            result: $Utils.Optional<Skill_registrationsGroupByOutputType>[]
          }
          count: {
            args: Prisma.skill_registrationsCountArgs<ExtArgs>
            result: $Utils.Optional<Skill_registrationsCountAggregateOutputType> | number
          }
        }
      }
      field_definitions: {
        payload: Prisma.$field_definitionsPayload<ExtArgs>
        fields: Prisma.field_definitionsFieldRefs
        operations: {
          findUnique: {
            args: Prisma.field_definitionsFindUniqueArgs<ExtArgs>
            result: $Utils.PayloadToResult<Prisma.$field_definitionsPayload> | null
          }
          findUniqueOrThrow: {
            args: Prisma.field_definitionsFindUniqueOrThrowArgs<ExtArgs>
            result: $Utils.PayloadToResult<Prisma.$field_definitionsPayload>
          }
          findFirst: {
            args: Prisma.field_definitionsFindFirstArgs<ExtArgs>
            result: $Utils.PayloadToResult<Prisma.$field_definitionsPayload> | null
          }
          findFirstOrThrow: {
            args: Prisma.field_definitionsFindFirstOrThrowArgs<ExtArgs>
            result: $Utils.PayloadToResult<Prisma.$field_definitionsPayload>
          }
          findMany: {
            args: Prisma.field_definitionsFindManyArgs<ExtArgs>
            result: $Utils.PayloadToResult<Prisma.$field_definitionsPayload>[]
          }
          create: {
            args: Prisma.field_definitionsCreateArgs<ExtArgs>
            result: $Utils.PayloadToResult<Prisma.$field_definitionsPayload>
          }
          createMany: {
            args: Prisma.field_definitionsCreateManyArgs<ExtArgs>
            result: BatchPayload
          }
          createManyAndReturn: {
            args: Prisma.field_definitionsCreateManyAndReturnArgs<ExtArgs>
            result: $Utils.PayloadToResult<Prisma.$field_definitionsPayload>[]
          }
          delete: {
            args: Prisma.field_definitionsDeleteArgs<ExtArgs>
            result: $Utils.PayloadToResult<Prisma.$field_definitionsPayload>
          }
          update: {
            args: Prisma.field_definitionsUpdateArgs<ExtArgs>
            result: $Utils.PayloadToResult<Prisma.$field_definitionsPayload>
          }
          deleteMany: {
            args: Prisma.field_definitionsDeleteManyArgs<ExtArgs>
            result: BatchPayload
          }
          updateMany: {
            args: Prisma.field_definitionsUpdateManyArgs<ExtArgs>
            result: BatchPayload
          }
          upsert: {
            args: Prisma.field_definitionsUpsertArgs<ExtArgs>
            result: $Utils.PayloadToResult<Prisma.$field_definitionsPayload>
          }
          aggregate: {
            args: Prisma.Field_definitionsAggregateArgs<ExtArgs>
            result: $Utils.Optional<AggregateField_definitions>
          }
          groupBy: {
            args: Prisma.field_definitionsGroupByArgs<ExtArgs>
            result: $Utils.Optional<Field_definitionsGroupByOutputType>[]
          }
          count: {
            args: Prisma.field_definitionsCountArgs<ExtArgs>
            result: $Utils.Optional<Field_definitionsCountAggregateOutputType> | number
          }
        }
      }
      agent_contracts: {
        payload: Prisma.$agent_contractsPayload<ExtArgs>
        fields: Prisma.agent_contractsFieldRefs
        operations: {
          findUnique: {
            args: Prisma.agent_contractsFindUniqueArgs<ExtArgs>
            result: $Utils.PayloadToResult<Prisma.$agent_contractsPayload> | null
          }
          findUniqueOrThrow: {
            args: Prisma.agent_contractsFindUniqueOrThrowArgs<ExtArgs>
            result: $Utils.PayloadToResult<Prisma.$agent_contractsPayload>
          }
          findFirst: {
            args: Prisma.agent_contractsFindFirstArgs<ExtArgs>
            result: $Utils.PayloadToResult<Prisma.$agent_contractsPayload> | null
          }
          findFirstOrThrow: {
            args: Prisma.agent_contractsFindFirstOrThrowArgs<ExtArgs>
            result: $Utils.PayloadToResult<Prisma.$agent_contractsPayload>
          }
          findMany: {
            args: Prisma.agent_contractsFindManyArgs<ExtArgs>
            result: $Utils.PayloadToResult<Prisma.$agent_contractsPayload>[]
          }
          create: {
            args: Prisma.agent_contractsCreateArgs<ExtArgs>
            result: $Utils.PayloadToResult<Prisma.$agent_contractsPayload>
          }
          createMany: {
            args: Prisma.agent_contractsCreateManyArgs<ExtArgs>
            result: BatchPayload
          }
          createManyAndReturn: {
            args: Prisma.agent_contractsCreateManyAndReturnArgs<ExtArgs>
            result: $Utils.PayloadToResult<Prisma.$agent_contractsPayload>[]
          }
          delete: {
            args: Prisma.agent_contractsDeleteArgs<ExtArgs>
            result: $Utils.PayloadToResult<Prisma.$agent_contractsPayload>
          }
          update: {
            args: Prisma.agent_contractsUpdateArgs<ExtArgs>
            result: $Utils.PayloadToResult<Prisma.$agent_contractsPayload>
          }
          deleteMany: {
            args: Prisma.agent_contractsDeleteManyArgs<ExtArgs>
            result: BatchPayload
          }
          updateMany: {
            args: Prisma.agent_contractsUpdateManyArgs<ExtArgs>
            result: BatchPayload
          }
          upsert: {
            args: Prisma.agent_contractsUpsertArgs<ExtArgs>
            result: $Utils.PayloadToResult<Prisma.$agent_contractsPayload>
          }
          aggregate: {
            args: Prisma.Agent_contractsAggregateArgs<ExtArgs>
            result: $Utils.Optional<AggregateAgent_contracts>
          }
          groupBy: {
            args: Prisma.agent_contractsGroupByArgs<ExtArgs>
            result: $Utils.Optional<Agent_contractsGroupByOutputType>[]
          }
          count: {
            args: Prisma.agent_contractsCountArgs<ExtArgs>
            result: $Utils.Optional<Agent_contractsCountAggregateOutputType> | number
          }
        }
      }
      agent_field_routings: {
        payload: Prisma.$agent_field_routingsPayload<ExtArgs>
        fields: Prisma.agent_field_routingsFieldRefs
        operations: {
          findUnique: {
            args: Prisma.agent_field_routingsFindUniqueArgs<ExtArgs>
            result: $Utils.PayloadToResult<Prisma.$agent_field_routingsPayload> | null
          }
          findUniqueOrThrow: {
            args: Prisma.agent_field_routingsFindUniqueOrThrowArgs<ExtArgs>
            result: $Utils.PayloadToResult<Prisma.$agent_field_routingsPayload>
          }
          findFirst: {
            args: Prisma.agent_field_routingsFindFirstArgs<ExtArgs>
            result: $Utils.PayloadToResult<Prisma.$agent_field_routingsPayload> | null
          }
          findFirstOrThrow: {
            args: Prisma.agent_field_routingsFindFirstOrThrowArgs<ExtArgs>
            result: $Utils.PayloadToResult<Prisma.$agent_field_routingsPayload>
          }
          findMany: {
            args: Prisma.agent_field_routingsFindManyArgs<ExtArgs>
            result: $Utils.PayloadToResult<Prisma.$agent_field_routingsPayload>[]
          }
          create: {
            args: Prisma.agent_field_routingsCreateArgs<ExtArgs>
            result: $Utils.PayloadToResult<Prisma.$agent_field_routingsPayload>
          }
          createMany: {
            args: Prisma.agent_field_routingsCreateManyArgs<ExtArgs>
            result: BatchPayload
          }
          createManyAndReturn: {
            args: Prisma.agent_field_routingsCreateManyAndReturnArgs<ExtArgs>
            result: $Utils.PayloadToResult<Prisma.$agent_field_routingsPayload>[]
          }
          delete: {
            args: Prisma.agent_field_routingsDeleteArgs<ExtArgs>
            result: $Utils.PayloadToResult<Prisma.$agent_field_routingsPayload>
          }
          update: {
            args: Prisma.agent_field_routingsUpdateArgs<ExtArgs>
            result: $Utils.PayloadToResult<Prisma.$agent_field_routingsPayload>
          }
          deleteMany: {
            args: Prisma.agent_field_routingsDeleteManyArgs<ExtArgs>
            result: BatchPayload
          }
          updateMany: {
            args: Prisma.agent_field_routingsUpdateManyArgs<ExtArgs>
            result: BatchPayload
          }
          upsert: {
            args: Prisma.agent_field_routingsUpsertArgs<ExtArgs>
            result: $Utils.PayloadToResult<Prisma.$agent_field_routingsPayload>
          }
          aggregate: {
            args: Prisma.Agent_field_routingsAggregateArgs<ExtArgs>
            result: $Utils.Optional<AggregateAgent_field_routings>
          }
          groupBy: {
            args: Prisma.agent_field_routingsGroupByArgs<ExtArgs>
            result: $Utils.Optional<Agent_field_routingsGroupByOutputType>[]
          }
          count: {
            args: Prisma.agent_field_routingsCountArgs<ExtArgs>
            result: $Utils.Optional<Agent_field_routingsCountAggregateOutputType> | number
          }
        }
      }
      node_config_changes: {
        payload: Prisma.$node_config_changesPayload<ExtArgs>
        fields: Prisma.node_config_changesFieldRefs
        operations: {
          findUnique: {
            args: Prisma.node_config_changesFindUniqueArgs<ExtArgs>
            result: $Utils.PayloadToResult<Prisma.$node_config_changesPayload> | null
          }
          findUniqueOrThrow: {
            args: Prisma.node_config_changesFindUniqueOrThrowArgs<ExtArgs>
            result: $Utils.PayloadToResult<Prisma.$node_config_changesPayload>
          }
          findFirst: {
            args: Prisma.node_config_changesFindFirstArgs<ExtArgs>
            result: $Utils.PayloadToResult<Prisma.$node_config_changesPayload> | null
          }
          findFirstOrThrow: {
            args: Prisma.node_config_changesFindFirstOrThrowArgs<ExtArgs>
            result: $Utils.PayloadToResult<Prisma.$node_config_changesPayload>
          }
          findMany: {
            args: Prisma.node_config_changesFindManyArgs<ExtArgs>
            result: $Utils.PayloadToResult<Prisma.$node_config_changesPayload>[]
          }
          create: {
            args: Prisma.node_config_changesCreateArgs<ExtArgs>
            result: $Utils.PayloadToResult<Prisma.$node_config_changesPayload>
          }
          createMany: {
            args: Prisma.node_config_changesCreateManyArgs<ExtArgs>
            result: BatchPayload
          }
          createManyAndReturn: {
            args: Prisma.node_config_changesCreateManyAndReturnArgs<ExtArgs>
            result: $Utils.PayloadToResult<Prisma.$node_config_changesPayload>[]
          }
          delete: {
            args: Prisma.node_config_changesDeleteArgs<ExtArgs>
            result: $Utils.PayloadToResult<Prisma.$node_config_changesPayload>
          }
          update: {
            args: Prisma.node_config_changesUpdateArgs<ExtArgs>
            result: $Utils.PayloadToResult<Prisma.$node_config_changesPayload>
          }
          deleteMany: {
            args: Prisma.node_config_changesDeleteManyArgs<ExtArgs>
            result: BatchPayload
          }
          updateMany: {
            args: Prisma.node_config_changesUpdateManyArgs<ExtArgs>
            result: BatchPayload
          }
          upsert: {
            args: Prisma.node_config_changesUpsertArgs<ExtArgs>
            result: $Utils.PayloadToResult<Prisma.$node_config_changesPayload>
          }
          aggregate: {
            args: Prisma.Node_config_changesAggregateArgs<ExtArgs>
            result: $Utils.Optional<AggregateNode_config_changes>
          }
          groupBy: {
            args: Prisma.node_config_changesGroupByArgs<ExtArgs>
            result: $Utils.Optional<Node_config_changesGroupByOutputType>[]
          }
          count: {
            args: Prisma.node_config_changesCountArgs<ExtArgs>
            result: $Utils.Optional<Node_config_changesCountAggregateOutputType> | number
          }
        }
      }
      prompt_eval_cases: {
        payload: Prisma.$prompt_eval_casesPayload<ExtArgs>
        fields: Prisma.prompt_eval_casesFieldRefs
        operations: {
          findUnique: {
            args: Prisma.prompt_eval_casesFindUniqueArgs<ExtArgs>
            result: $Utils.PayloadToResult<Prisma.$prompt_eval_casesPayload> | null
          }
          findUniqueOrThrow: {
            args: Prisma.prompt_eval_casesFindUniqueOrThrowArgs<ExtArgs>
            result: $Utils.PayloadToResult<Prisma.$prompt_eval_casesPayload>
          }
          findFirst: {
            args: Prisma.prompt_eval_casesFindFirstArgs<ExtArgs>
            result: $Utils.PayloadToResult<Prisma.$prompt_eval_casesPayload> | null
          }
          findFirstOrThrow: {
            args: Prisma.prompt_eval_casesFindFirstOrThrowArgs<ExtArgs>
            result: $Utils.PayloadToResult<Prisma.$prompt_eval_casesPayload>
          }
          findMany: {
            args: Prisma.prompt_eval_casesFindManyArgs<ExtArgs>
            result: $Utils.PayloadToResult<Prisma.$prompt_eval_casesPayload>[]
          }
          create: {
            args: Prisma.prompt_eval_casesCreateArgs<ExtArgs>
            result: $Utils.PayloadToResult<Prisma.$prompt_eval_casesPayload>
          }
          createMany: {
            args: Prisma.prompt_eval_casesCreateManyArgs<ExtArgs>
            result: BatchPayload
          }
          createManyAndReturn: {
            args: Prisma.prompt_eval_casesCreateManyAndReturnArgs<ExtArgs>
            result: $Utils.PayloadToResult<Prisma.$prompt_eval_casesPayload>[]
          }
          delete: {
            args: Prisma.prompt_eval_casesDeleteArgs<ExtArgs>
            result: $Utils.PayloadToResult<Prisma.$prompt_eval_casesPayload>
          }
          update: {
            args: Prisma.prompt_eval_casesUpdateArgs<ExtArgs>
            result: $Utils.PayloadToResult<Prisma.$prompt_eval_casesPayload>
          }
          deleteMany: {
            args: Prisma.prompt_eval_casesDeleteManyArgs<ExtArgs>
            result: BatchPayload
          }
          updateMany: {
            args: Prisma.prompt_eval_casesUpdateManyArgs<ExtArgs>
            result: BatchPayload
          }
          upsert: {
            args: Prisma.prompt_eval_casesUpsertArgs<ExtArgs>
            result: $Utils.PayloadToResult<Prisma.$prompt_eval_casesPayload>
          }
          aggregate: {
            args: Prisma.Prompt_eval_casesAggregateArgs<ExtArgs>
            result: $Utils.Optional<AggregatePrompt_eval_cases>
          }
          groupBy: {
            args: Prisma.prompt_eval_casesGroupByArgs<ExtArgs>
            result: $Utils.Optional<Prompt_eval_casesGroupByOutputType>[]
          }
          count: {
            args: Prisma.prompt_eval_casesCountArgs<ExtArgs>
            result: $Utils.Optional<Prompt_eval_casesCountAggregateOutputType> | number
          }
        }
      }
      prompt_eval_runs: {
        payload: Prisma.$prompt_eval_runsPayload<ExtArgs>
        fields: Prisma.prompt_eval_runsFieldRefs
        operations: {
          findUnique: {
            args: Prisma.prompt_eval_runsFindUniqueArgs<ExtArgs>
            result: $Utils.PayloadToResult<Prisma.$prompt_eval_runsPayload> | null
          }
          findUniqueOrThrow: {
            args: Prisma.prompt_eval_runsFindUniqueOrThrowArgs<ExtArgs>
            result: $Utils.PayloadToResult<Prisma.$prompt_eval_runsPayload>
          }
          findFirst: {
            args: Prisma.prompt_eval_runsFindFirstArgs<ExtArgs>
            result: $Utils.PayloadToResult<Prisma.$prompt_eval_runsPayload> | null
          }
          findFirstOrThrow: {
            args: Prisma.prompt_eval_runsFindFirstOrThrowArgs<ExtArgs>
            result: $Utils.PayloadToResult<Prisma.$prompt_eval_runsPayload>
          }
          findMany: {
            args: Prisma.prompt_eval_runsFindManyArgs<ExtArgs>
            result: $Utils.PayloadToResult<Prisma.$prompt_eval_runsPayload>[]
          }
          create: {
            args: Prisma.prompt_eval_runsCreateArgs<ExtArgs>
            result: $Utils.PayloadToResult<Prisma.$prompt_eval_runsPayload>
          }
          createMany: {
            args: Prisma.prompt_eval_runsCreateManyArgs<ExtArgs>
            result: BatchPayload
          }
          createManyAndReturn: {
            args: Prisma.prompt_eval_runsCreateManyAndReturnArgs<ExtArgs>
            result: $Utils.PayloadToResult<Prisma.$prompt_eval_runsPayload>[]
          }
          delete: {
            args: Prisma.prompt_eval_runsDeleteArgs<ExtArgs>
            result: $Utils.PayloadToResult<Prisma.$prompt_eval_runsPayload>
          }
          update: {
            args: Prisma.prompt_eval_runsUpdateArgs<ExtArgs>
            result: $Utils.PayloadToResult<Prisma.$prompt_eval_runsPayload>
          }
          deleteMany: {
            args: Prisma.prompt_eval_runsDeleteManyArgs<ExtArgs>
            result: BatchPayload
          }
          updateMany: {
            args: Prisma.prompt_eval_runsUpdateManyArgs<ExtArgs>
            result: BatchPayload
          }
          upsert: {
            args: Prisma.prompt_eval_runsUpsertArgs<ExtArgs>
            result: $Utils.PayloadToResult<Prisma.$prompt_eval_runsPayload>
          }
          aggregate: {
            args: Prisma.Prompt_eval_runsAggregateArgs<ExtArgs>
            result: $Utils.Optional<AggregatePrompt_eval_runs>
          }
          groupBy: {
            args: Prisma.prompt_eval_runsGroupByArgs<ExtArgs>
            result: $Utils.Optional<Prompt_eval_runsGroupByOutputType>[]
          }
          count: {
            args: Prisma.prompt_eval_runsCountArgs<ExtArgs>
            result: $Utils.Optional<Prompt_eval_runsCountAggregateOutputType> | number
          }
        }
      }
    }
  } & {
    other: {
      payload: any
      operations: {
        $executeRaw: {
          args: [query: TemplateStringsArray | Prisma.Sql, ...values: any[]],
          result: any
        }
        $executeRawUnsafe: {
          args: [query: string, ...values: any[]],
          result: any
        }
        $queryRaw: {
          args: [query: TemplateStringsArray | Prisma.Sql, ...values: any[]],
          result: any
        }
        $queryRawUnsafe: {
          args: [query: string, ...values: any[]],
          result: any
        }
      }
    }
  }
  export const defineExtension: $Extensions.ExtendsHook<"define", Prisma.TypeMapCb, $Extensions.DefaultArgs>
  export type DefaultPrismaClient = PrismaClient
  export type ErrorFormat = 'pretty' | 'colorless' | 'minimal'
  export interface PrismaClientOptions {
    /**
     * Overwrites the datasource url from your schema.prisma file
     */
    datasources?: Datasources
    /**
     * Overwrites the datasource url from your schema.prisma file
     */
    datasourceUrl?: string
    /**
     * @default "colorless"
     */
    errorFormat?: ErrorFormat
    /**
     * @example
     * ```
     * // Defaults to stdout
     * log: ['query', 'info', 'warn', 'error']
     * 
     * // Emit as events
     * log: [
     *   { emit: 'stdout', level: 'query' },
     *   { emit: 'stdout', level: 'info' },
     *   { emit: 'stdout', level: 'warn' }
     *   { emit: 'stdout', level: 'error' }
     * ]
     * ```
     * Read more in our [docs](https://www.prisma.io/docs/reference/tools-and-interfaces/prisma-client/logging#the-log-option).
     */
    log?: (LogLevel | LogDefinition)[]
    /**
     * The default values for transactionOptions
     * maxWait ?= 2000
     * timeout ?= 5000
     */
    transactionOptions?: {
      maxWait?: number
      timeout?: number
      isolationLevel?: Prisma.TransactionIsolationLevel
    }
  }


  /* Types for Logging */
  export type LogLevel = 'info' | 'query' | 'warn' | 'error'
  export type LogDefinition = {
    level: LogLevel
    emit: 'stdout' | 'event'
  }

  export type GetLogType<T extends LogLevel | LogDefinition> = T extends LogDefinition ? T['emit'] extends 'event' ? T['level'] : never : never
  export type GetEvents<T extends any> = T extends Array<LogLevel | LogDefinition> ?
    GetLogType<T[0]> | GetLogType<T[1]> | GetLogType<T[2]> | GetLogType<T[3]>
    : never

  export type QueryEvent = {
    timestamp: Date
    query: string
    params: string
    duration: number
    target: string
  }

  export type LogEvent = {
    timestamp: Date
    message: string
    target: string
  }
  /* End Types for Logging */


  export type PrismaAction =
    | 'findUnique'
    | 'findUniqueOrThrow'
    | 'findMany'
    | 'findFirst'
    | 'findFirstOrThrow'
    | 'create'
    | 'createMany'
    | 'createManyAndReturn'
    | 'update'
    | 'updateMany'
    | 'upsert'
    | 'delete'
    | 'deleteMany'
    | 'executeRaw'
    | 'queryRaw'
    | 'aggregate'
    | 'count'
    | 'runCommandRaw'
    | 'findRaw'
    | 'groupBy'

  /**
   * These options are being passed into the middleware as "params"
   */
  export type MiddlewareParams = {
    model?: ModelName
    action: PrismaAction
    args: any
    dataPath: string[]
    runInTransaction: boolean
  }

  /**
   * The `T` type makes sure, that the `return proceed` is not forgotten in the middleware implementation
   */
  export type Middleware<T = any> = (
    params: MiddlewareParams,
    next: (params: MiddlewareParams) => $Utils.JsPromise<T>,
  ) => $Utils.JsPromise<T>

  // tested in getLogLevel.test.ts
  export function getLogLevel(log: Array<LogLevel | LogDefinition>): LogLevel | undefined;

  /**
   * `PrismaClient` proxy available in interactive transactions.
   */
  export type TransactionClient = Omit<Prisma.DefaultPrismaClient, runtime.ITXClientDenyList>

  export type Datasource = {
    url?: string
  }

  /**
   * Count Types
   */



  /**
   * Models
   */

  /**
   * Model agent_lab_configs
   */

  export type AggregateAgent_lab_configs = {
    _count: Agent_lab_configsCountAggregateOutputType | null
    _avg: Agent_lab_configsAvgAggregateOutputType | null
    _sum: Agent_lab_configsSumAggregateOutputType | null
    _min: Agent_lab_configsMinAggregateOutputType | null
    _max: Agent_lab_configsMaxAggregateOutputType | null
  }

  export type Agent_lab_configsAvgAggregateOutputType = {
    temperature: number | null
    maxTokens: number | null
  }

  export type Agent_lab_configsSumAggregateOutputType = {
    temperature: number | null
    maxTokens: number | null
  }

  export type Agent_lab_configsMinAggregateOutputType = {
    id: string | null
    agentName: string | null
    model: string | null
    temperature: number | null
    maxTokens: number | null
    baseURL: string | null
    apiKey: string | null
    systemPrompt: string | null
    extraConfig: string | null
    createdAt: Date | null
    updatedAt: Date | null
  }

  export type Agent_lab_configsMaxAggregateOutputType = {
    id: string | null
    agentName: string | null
    model: string | null
    temperature: number | null
    maxTokens: number | null
    baseURL: string | null
    apiKey: string | null
    systemPrompt: string | null
    extraConfig: string | null
    createdAt: Date | null
    updatedAt: Date | null
  }

  export type Agent_lab_configsCountAggregateOutputType = {
    id: number
    agentName: number
    model: number
    temperature: number
    maxTokens: number
    baseURL: number
    apiKey: number
    systemPrompt: number
    extraConfig: number
    createdAt: number
    updatedAt: number
    _all: number
  }


  export type Agent_lab_configsAvgAggregateInputType = {
    temperature?: true
    maxTokens?: true
  }

  export type Agent_lab_configsSumAggregateInputType = {
    temperature?: true
    maxTokens?: true
  }

  export type Agent_lab_configsMinAggregateInputType = {
    id?: true
    agentName?: true
    model?: true
    temperature?: true
    maxTokens?: true
    baseURL?: true
    apiKey?: true
    systemPrompt?: true
    extraConfig?: true
    createdAt?: true
    updatedAt?: true
  }

  export type Agent_lab_configsMaxAggregateInputType = {
    id?: true
    agentName?: true
    model?: true
    temperature?: true
    maxTokens?: true
    baseURL?: true
    apiKey?: true
    systemPrompt?: true
    extraConfig?: true
    createdAt?: true
    updatedAt?: true
  }

  export type Agent_lab_configsCountAggregateInputType = {
    id?: true
    agentName?: true
    model?: true
    temperature?: true
    maxTokens?: true
    baseURL?: true
    apiKey?: true
    systemPrompt?: true
    extraConfig?: true
    createdAt?: true
    updatedAt?: true
    _all?: true
  }

  export type Agent_lab_configsAggregateArgs<ExtArgs extends $Extensions.InternalArgs = $Extensions.DefaultArgs> = {
    /**
     * Filter which agent_lab_configs to aggregate.
     */
    where?: agent_lab_configsWhereInput
    /**
     * {@link https://www.prisma.io/docs/concepts/components/prisma-client/sorting Sorting Docs}
     * 
     * Determine the order of agent_lab_configs to fetch.
     */
    orderBy?: agent_lab_configsOrderByWithRelationInput | agent_lab_configsOrderByWithRelationInput[]
    /**
     * {@link https://www.prisma.io/docs/concepts/components/prisma-client/pagination#cursor-based-pagination Cursor Docs}
     * 
     * Sets the start position
     */
    cursor?: agent_lab_configsWhereUniqueInput
    /**
     * {@link https://www.prisma.io/docs/concepts/components/prisma-client/pagination Pagination Docs}
     * 
     * Take `±n` agent_lab_configs from the position of the cursor.
     */
    take?: number
    /**
     * {@link https://www.prisma.io/docs/concepts/components/prisma-client/pagination Pagination Docs}
     * 
     * Skip the first `n` agent_lab_configs.
     */
    skip?: number
    /**
     * {@link https://www.prisma.io/docs/concepts/components/prisma-client/aggregations Aggregation Docs}
     * 
     * Count returned agent_lab_configs
    **/
    _count?: true | Agent_lab_configsCountAggregateInputType
    /**
     * {@link https://www.prisma.io/docs/concepts/components/prisma-client/aggregations Aggregation Docs}
     * 
     * Select which fields to average
    **/
    _avg?: Agent_lab_configsAvgAggregateInputType
    /**
     * {@link https://www.prisma.io/docs/concepts/components/prisma-client/aggregations Aggregation Docs}
     * 
     * Select which fields to sum
    **/
    _sum?: Agent_lab_configsSumAggregateInputType
    /**
     * {@link https://www.prisma.io/docs/concepts/components/prisma-client/aggregations Aggregation Docs}
     * 
     * Select which fields to find the minimum value
    **/
    _min?: Agent_lab_configsMinAggregateInputType
    /**
     * {@link https://www.prisma.io/docs/concepts/components/prisma-client/aggregations Aggregation Docs}
     * 
     * Select which fields to find the maximum value
    **/
    _max?: Agent_lab_configsMaxAggregateInputType
  }

  export type GetAgent_lab_configsAggregateType<T extends Agent_lab_configsAggregateArgs> = {
        [P in keyof T & keyof AggregateAgent_lab_configs]: P extends '_count' | 'count'
      ? T[P] extends true
        ? number
        : GetScalarType<T[P], AggregateAgent_lab_configs[P]>
      : GetScalarType<T[P], AggregateAgent_lab_configs[P]>
  }




  export type agent_lab_configsGroupByArgs<ExtArgs extends $Extensions.InternalArgs = $Extensions.DefaultArgs> = {
    where?: agent_lab_configsWhereInput
    orderBy?: agent_lab_configsOrderByWithAggregationInput | agent_lab_configsOrderByWithAggregationInput[]
    by: Agent_lab_configsScalarFieldEnum[] | Agent_lab_configsScalarFieldEnum
    having?: agent_lab_configsScalarWhereWithAggregatesInput
    take?: number
    skip?: number
    _count?: Agent_lab_configsCountAggregateInputType | true
    _avg?: Agent_lab_configsAvgAggregateInputType
    _sum?: Agent_lab_configsSumAggregateInputType
    _min?: Agent_lab_configsMinAggregateInputType
    _max?: Agent_lab_configsMaxAggregateInputType
  }

  export type Agent_lab_configsGroupByOutputType = {
    id: string
    agentName: string
    model: string | null
    temperature: number | null
    maxTokens: number | null
    baseURL: string | null
    apiKey: string | null
    systemPrompt: string | null
    extraConfig: string | null
    createdAt: Date
    updatedAt: Date
    _count: Agent_lab_configsCountAggregateOutputType | null
    _avg: Agent_lab_configsAvgAggregateOutputType | null
    _sum: Agent_lab_configsSumAggregateOutputType | null
    _min: Agent_lab_configsMinAggregateOutputType | null
    _max: Agent_lab_configsMaxAggregateOutputType | null
  }

  type GetAgent_lab_configsGroupByPayload<T extends agent_lab_configsGroupByArgs> = Prisma.PrismaPromise<
    Array<
      PickEnumerable<Agent_lab_configsGroupByOutputType, T['by']> &
        {
          [P in ((keyof T) & (keyof Agent_lab_configsGroupByOutputType))]: P extends '_count'
            ? T[P] extends boolean
              ? number
              : GetScalarType<T[P], Agent_lab_configsGroupByOutputType[P]>
            : GetScalarType<T[P], Agent_lab_configsGroupByOutputType[P]>
        }
      >
    >


  export type agent_lab_configsSelect<ExtArgs extends $Extensions.InternalArgs = $Extensions.DefaultArgs> = $Extensions.GetSelect<{
    id?: boolean
    agentName?: boolean
    model?: boolean
    temperature?: boolean
    maxTokens?: boolean
    baseURL?: boolean
    apiKey?: boolean
    systemPrompt?: boolean
    extraConfig?: boolean
    createdAt?: boolean
    updatedAt?: boolean
  }, ExtArgs["result"]["agent_lab_configs"]>

  export type agent_lab_configsSelectCreateManyAndReturn<ExtArgs extends $Extensions.InternalArgs = $Extensions.DefaultArgs> = $Extensions.GetSelect<{
    id?: boolean
    agentName?: boolean
    model?: boolean
    temperature?: boolean
    maxTokens?: boolean
    baseURL?: boolean
    apiKey?: boolean
    systemPrompt?: boolean
    extraConfig?: boolean
    createdAt?: boolean
    updatedAt?: boolean
  }, ExtArgs["result"]["agent_lab_configs"]>

  export type agent_lab_configsSelectScalar = {
    id?: boolean
    agentName?: boolean
    model?: boolean
    temperature?: boolean
    maxTokens?: boolean
    baseURL?: boolean
    apiKey?: boolean
    systemPrompt?: boolean
    extraConfig?: boolean
    createdAt?: boolean
    updatedAt?: boolean
  }


  export type $agent_lab_configsPayload<ExtArgs extends $Extensions.InternalArgs = $Extensions.DefaultArgs> = {
    name: "agent_lab_configs"
    objects: {}
    scalars: $Extensions.GetPayloadResult<{
      id: string
      agentName: string
      model: string | null
      temperature: number | null
      maxTokens: number | null
      baseURL: string | null
      apiKey: string | null
      systemPrompt: string | null
      extraConfig: string | null
      createdAt: Date
      updatedAt: Date
    }, ExtArgs["result"]["agent_lab_configs"]>
    composites: {}
  }

  type agent_lab_configsGetPayload<S extends boolean | null | undefined | agent_lab_configsDefaultArgs> = $Result.GetResult<Prisma.$agent_lab_configsPayload, S>

  type agent_lab_configsCountArgs<ExtArgs extends $Extensions.InternalArgs = $Extensions.DefaultArgs> = 
    Omit<agent_lab_configsFindManyArgs, 'select' | 'include' | 'distinct'> & {
      select?: Agent_lab_configsCountAggregateInputType | true
    }

  export interface agent_lab_configsDelegate<ExtArgs extends $Extensions.InternalArgs = $Extensions.DefaultArgs> {
    [K: symbol]: { types: Prisma.TypeMap<ExtArgs>['model']['agent_lab_configs'], meta: { name: 'agent_lab_configs' } }
    /**
     * Find zero or one Agent_lab_configs that matches the filter.
     * @param {agent_lab_configsFindUniqueArgs} args - Arguments to find a Agent_lab_configs
     * @example
     * // Get one Agent_lab_configs
     * const agent_lab_configs = await prisma.agent_lab_configs.findUnique({
     *   where: {
     *     // ... provide filter here
     *   }
     * })
     */
    findUnique<T extends agent_lab_configsFindUniqueArgs>(args: SelectSubset<T, agent_lab_configsFindUniqueArgs<ExtArgs>>): Prisma__agent_lab_configsClient<$Result.GetResult<Prisma.$agent_lab_configsPayload<ExtArgs>, T, "findUnique"> | null, null, ExtArgs>

    /**
     * Find one Agent_lab_configs that matches the filter or throw an error with `error.code='P2025'` 
     * if no matches were found.
     * @param {agent_lab_configsFindUniqueOrThrowArgs} args - Arguments to find a Agent_lab_configs
     * @example
     * // Get one Agent_lab_configs
     * const agent_lab_configs = await prisma.agent_lab_configs.findUniqueOrThrow({
     *   where: {
     *     // ... provide filter here
     *   }
     * })
     */
    findUniqueOrThrow<T extends agent_lab_configsFindUniqueOrThrowArgs>(args: SelectSubset<T, agent_lab_configsFindUniqueOrThrowArgs<ExtArgs>>): Prisma__agent_lab_configsClient<$Result.GetResult<Prisma.$agent_lab_configsPayload<ExtArgs>, T, "findUniqueOrThrow">, never, ExtArgs>

    /**
     * Find the first Agent_lab_configs that matches the filter.
     * Note, that providing `undefined` is treated as the value not being there.
     * Read more here: https://pris.ly/d/null-undefined
     * @param {agent_lab_configsFindFirstArgs} args - Arguments to find a Agent_lab_configs
     * @example
     * // Get one Agent_lab_configs
     * const agent_lab_configs = await prisma.agent_lab_configs.findFirst({
     *   where: {
     *     // ... provide filter here
     *   }
     * })
     */
    findFirst<T extends agent_lab_configsFindFirstArgs>(args?: SelectSubset<T, agent_lab_configsFindFirstArgs<ExtArgs>>): Prisma__agent_lab_configsClient<$Result.GetResult<Prisma.$agent_lab_configsPayload<ExtArgs>, T, "findFirst"> | null, null, ExtArgs>

    /**
     * Find the first Agent_lab_configs that matches the filter or
     * throw `PrismaKnownClientError` with `P2025` code if no matches were found.
     * Note, that providing `undefined` is treated as the value not being there.
     * Read more here: https://pris.ly/d/null-undefined
     * @param {agent_lab_configsFindFirstOrThrowArgs} args - Arguments to find a Agent_lab_configs
     * @example
     * // Get one Agent_lab_configs
     * const agent_lab_configs = await prisma.agent_lab_configs.findFirstOrThrow({
     *   where: {
     *     // ... provide filter here
     *   }
     * })
     */
    findFirstOrThrow<T extends agent_lab_configsFindFirstOrThrowArgs>(args?: SelectSubset<T, agent_lab_configsFindFirstOrThrowArgs<ExtArgs>>): Prisma__agent_lab_configsClient<$Result.GetResult<Prisma.$agent_lab_configsPayload<ExtArgs>, T, "findFirstOrThrow">, never, ExtArgs>

    /**
     * Find zero or more Agent_lab_configs that matches the filter.
     * Note, that providing `undefined` is treated as the value not being there.
     * Read more here: https://pris.ly/d/null-undefined
     * @param {agent_lab_configsFindManyArgs} args - Arguments to filter and select certain fields only.
     * @example
     * // Get all Agent_lab_configs
     * const agent_lab_configs = await prisma.agent_lab_configs.findMany()
     * 
     * // Get first 10 Agent_lab_configs
     * const agent_lab_configs = await prisma.agent_lab_configs.findMany({ take: 10 })
     * 
     * // Only select the `id`
     * const agent_lab_configsWithIdOnly = await prisma.agent_lab_configs.findMany({ select: { id: true } })
     * 
     */
    findMany<T extends agent_lab_configsFindManyArgs>(args?: SelectSubset<T, agent_lab_configsFindManyArgs<ExtArgs>>): Prisma.PrismaPromise<$Result.GetResult<Prisma.$agent_lab_configsPayload<ExtArgs>, T, "findMany">>

    /**
     * Create a Agent_lab_configs.
     * @param {agent_lab_configsCreateArgs} args - Arguments to create a Agent_lab_configs.
     * @example
     * // Create one Agent_lab_configs
     * const Agent_lab_configs = await prisma.agent_lab_configs.create({
     *   data: {
     *     // ... data to create a Agent_lab_configs
     *   }
     * })
     * 
     */
    create<T extends agent_lab_configsCreateArgs>(args: SelectSubset<T, agent_lab_configsCreateArgs<ExtArgs>>): Prisma__agent_lab_configsClient<$Result.GetResult<Prisma.$agent_lab_configsPayload<ExtArgs>, T, "create">, never, ExtArgs>

    /**
     * Create many Agent_lab_configs.
     * @param {agent_lab_configsCreateManyArgs} args - Arguments to create many Agent_lab_configs.
     * @example
     * // Create many Agent_lab_configs
     * const agent_lab_configs = await prisma.agent_lab_configs.createMany({
     *   data: [
     *     // ... provide data here
     *   ]
     * })
     *     
     */
    createMany<T extends agent_lab_configsCreateManyArgs>(args?: SelectSubset<T, agent_lab_configsCreateManyArgs<ExtArgs>>): Prisma.PrismaPromise<BatchPayload>

    /**
     * Create many Agent_lab_configs and returns the data saved in the database.
     * @param {agent_lab_configsCreateManyAndReturnArgs} args - Arguments to create many Agent_lab_configs.
     * @example
     * // Create many Agent_lab_configs
     * const agent_lab_configs = await prisma.agent_lab_configs.createManyAndReturn({
     *   data: [
     *     // ... provide data here
     *   ]
     * })
     * 
     * // Create many Agent_lab_configs and only return the `id`
     * const agent_lab_configsWithIdOnly = await prisma.agent_lab_configs.createManyAndReturn({ 
     *   select: { id: true },
     *   data: [
     *     // ... provide data here
     *   ]
     * })
     * Note, that providing `undefined` is treated as the value not being there.
     * Read more here: https://pris.ly/d/null-undefined
     * 
     */
    createManyAndReturn<T extends agent_lab_configsCreateManyAndReturnArgs>(args?: SelectSubset<T, agent_lab_configsCreateManyAndReturnArgs<ExtArgs>>): Prisma.PrismaPromise<$Result.GetResult<Prisma.$agent_lab_configsPayload<ExtArgs>, T, "createManyAndReturn">>

    /**
     * Delete a Agent_lab_configs.
     * @param {agent_lab_configsDeleteArgs} args - Arguments to delete one Agent_lab_configs.
     * @example
     * // Delete one Agent_lab_configs
     * const Agent_lab_configs = await prisma.agent_lab_configs.delete({
     *   where: {
     *     // ... filter to delete one Agent_lab_configs
     *   }
     * })
     * 
     */
    delete<T extends agent_lab_configsDeleteArgs>(args: SelectSubset<T, agent_lab_configsDeleteArgs<ExtArgs>>): Prisma__agent_lab_configsClient<$Result.GetResult<Prisma.$agent_lab_configsPayload<ExtArgs>, T, "delete">, never, ExtArgs>

    /**
     * Update one Agent_lab_configs.
     * @param {agent_lab_configsUpdateArgs} args - Arguments to update one Agent_lab_configs.
     * @example
     * // Update one Agent_lab_configs
     * const agent_lab_configs = await prisma.agent_lab_configs.update({
     *   where: {
     *     // ... provide filter here
     *   },
     *   data: {
     *     // ... provide data here
     *   }
     * })
     * 
     */
    update<T extends agent_lab_configsUpdateArgs>(args: SelectSubset<T, agent_lab_configsUpdateArgs<ExtArgs>>): Prisma__agent_lab_configsClient<$Result.GetResult<Prisma.$agent_lab_configsPayload<ExtArgs>, T, "update">, never, ExtArgs>

    /**
     * Delete zero or more Agent_lab_configs.
     * @param {agent_lab_configsDeleteManyArgs} args - Arguments to filter Agent_lab_configs to delete.
     * @example
     * // Delete a few Agent_lab_configs
     * const { count } = await prisma.agent_lab_configs.deleteMany({
     *   where: {
     *     // ... provide filter here
     *   }
     * })
     * 
     */
    deleteMany<T extends agent_lab_configsDeleteManyArgs>(args?: SelectSubset<T, agent_lab_configsDeleteManyArgs<ExtArgs>>): Prisma.PrismaPromise<BatchPayload>

    /**
     * Update zero or more Agent_lab_configs.
     * Note, that providing `undefined` is treated as the value not being there.
     * Read more here: https://pris.ly/d/null-undefined
     * @param {agent_lab_configsUpdateManyArgs} args - Arguments to update one or more rows.
     * @example
     * // Update many Agent_lab_configs
     * const agent_lab_configs = await prisma.agent_lab_configs.updateMany({
     *   where: {
     *     // ... provide filter here
     *   },
     *   data: {
     *     // ... provide data here
     *   }
     * })
     * 
     */
    updateMany<T extends agent_lab_configsUpdateManyArgs>(args: SelectSubset<T, agent_lab_configsUpdateManyArgs<ExtArgs>>): Prisma.PrismaPromise<BatchPayload>

    /**
     * Create or update one Agent_lab_configs.
     * @param {agent_lab_configsUpsertArgs} args - Arguments to update or create a Agent_lab_configs.
     * @example
     * // Update or create a Agent_lab_configs
     * const agent_lab_configs = await prisma.agent_lab_configs.upsert({
     *   create: {
     *     // ... data to create a Agent_lab_configs
     *   },
     *   update: {
     *     // ... in case it already exists, update
     *   },
     *   where: {
     *     // ... the filter for the Agent_lab_configs we want to update
     *   }
     * })
     */
    upsert<T extends agent_lab_configsUpsertArgs>(args: SelectSubset<T, agent_lab_configsUpsertArgs<ExtArgs>>): Prisma__agent_lab_configsClient<$Result.GetResult<Prisma.$agent_lab_configsPayload<ExtArgs>, T, "upsert">, never, ExtArgs>


    /**
     * Count the number of Agent_lab_configs.
     * Note, that providing `undefined` is treated as the value not being there.
     * Read more here: https://pris.ly/d/null-undefined
     * @param {agent_lab_configsCountArgs} args - Arguments to filter Agent_lab_configs to count.
     * @example
     * // Count the number of Agent_lab_configs
     * const count = await prisma.agent_lab_configs.count({
     *   where: {
     *     // ... the filter for the Agent_lab_configs we want to count
     *   }
     * })
    **/
    count<T extends agent_lab_configsCountArgs>(
      args?: Subset<T, agent_lab_configsCountArgs>,
    ): Prisma.PrismaPromise<
      T extends $Utils.Record<'select', any>
        ? T['select'] extends true
          ? number
          : GetScalarType<T['select'], Agent_lab_configsCountAggregateOutputType>
        : number
    >

    /**
     * Allows you to perform aggregations operations on a Agent_lab_configs.
     * Note, that providing `undefined` is treated as the value not being there.
     * Read more here: https://pris.ly/d/null-undefined
     * @param {Agent_lab_configsAggregateArgs} args - Select which aggregations you would like to apply and on what fields.
     * @example
     * // Ordered by age ascending
     * // Where email contains prisma.io
     * // Limited to the 10 users
     * const aggregations = await prisma.user.aggregate({
     *   _avg: {
     *     age: true,
     *   },
     *   where: {
     *     email: {
     *       contains: "prisma.io",
     *     },
     *   },
     *   orderBy: {
     *     age: "asc",
     *   },
     *   take: 10,
     * })
    **/
    aggregate<T extends Agent_lab_configsAggregateArgs>(args: Subset<T, Agent_lab_configsAggregateArgs>): Prisma.PrismaPromise<GetAgent_lab_configsAggregateType<T>>

    /**
     * Group by Agent_lab_configs.
     * Note, that providing `undefined` is treated as the value not being there.
     * Read more here: https://pris.ly/d/null-undefined
     * @param {agent_lab_configsGroupByArgs} args - Group by arguments.
     * @example
     * // Group by city, order by createdAt, get count
     * const result = await prisma.user.groupBy({
     *   by: ['city', 'createdAt'],
     *   orderBy: {
     *     createdAt: true
     *   },
     *   _count: {
     *     _all: true
     *   },
     * })
     * 
    **/
    groupBy<
      T extends agent_lab_configsGroupByArgs,
      HasSelectOrTake extends Or<
        Extends<'skip', Keys<T>>,
        Extends<'take', Keys<T>>
      >,
      OrderByArg extends True extends HasSelectOrTake
        ? { orderBy: agent_lab_configsGroupByArgs['orderBy'] }
        : { orderBy?: agent_lab_configsGroupByArgs['orderBy'] },
      OrderFields extends ExcludeUnderscoreKeys<Keys<MaybeTupleToUnion<T['orderBy']>>>,
      ByFields extends MaybeTupleToUnion<T['by']>,
      ByValid extends Has<ByFields, OrderFields>,
      HavingFields extends GetHavingFields<T['having']>,
      HavingValid extends Has<ByFields, HavingFields>,
      ByEmpty extends T['by'] extends never[] ? True : False,
      InputErrors extends ByEmpty extends True
      ? `Error: "by" must not be empty.`
      : HavingValid extends False
      ? {
          [P in HavingFields]: P extends ByFields
            ? never
            : P extends string
            ? `Error: Field "${P}" used in "having" needs to be provided in "by".`
            : [
                Error,
                'Field ',
                P,
                ` in "having" needs to be provided in "by"`,
              ]
        }[HavingFields]
      : 'take' extends Keys<T>
      ? 'orderBy' extends Keys<T>
        ? ByValid extends True
          ? {}
          : {
              [P in OrderFields]: P extends ByFields
                ? never
                : `Error: Field "${P}" in "orderBy" needs to be provided in "by"`
            }[OrderFields]
        : 'Error: If you provide "take", you also need to provide "orderBy"'
      : 'skip' extends Keys<T>
      ? 'orderBy' extends Keys<T>
        ? ByValid extends True
          ? {}
          : {
              [P in OrderFields]: P extends ByFields
                ? never
                : `Error: Field "${P}" in "orderBy" needs to be provided in "by"`
            }[OrderFields]
        : 'Error: If you provide "skip", you also need to provide "orderBy"'
      : ByValid extends True
      ? {}
      : {
          [P in OrderFields]: P extends ByFields
            ? never
            : `Error: Field "${P}" in "orderBy" needs to be provided in "by"`
        }[OrderFields]
    >(args: SubsetIntersection<T, agent_lab_configsGroupByArgs, OrderByArg> & InputErrors): {} extends InputErrors ? GetAgent_lab_configsGroupByPayload<T> : Prisma.PrismaPromise<InputErrors>
  /**
   * Fields of the agent_lab_configs model
   */
  readonly fields: agent_lab_configsFieldRefs;
  }

  /**
   * The delegate class that acts as a "Promise-like" for agent_lab_configs.
   * Why is this prefixed with `Prisma__`?
   * Because we want to prevent naming conflicts as mentioned in
   * https://github.com/prisma/prisma-client-js/issues/707
   */
  export interface Prisma__agent_lab_configsClient<T, Null = never, ExtArgs extends $Extensions.InternalArgs = $Extensions.DefaultArgs> extends Prisma.PrismaPromise<T> {
    readonly [Symbol.toStringTag]: "PrismaPromise"
    /**
     * Attaches callbacks for the resolution and/or rejection of the Promise.
     * @param onfulfilled The callback to execute when the Promise is resolved.
     * @param onrejected The callback to execute when the Promise is rejected.
     * @returns A Promise for the completion of which ever callback is executed.
     */
    then<TResult1 = T, TResult2 = never>(onfulfilled?: ((value: T) => TResult1 | PromiseLike<TResult1>) | undefined | null, onrejected?: ((reason: any) => TResult2 | PromiseLike<TResult2>) | undefined | null): $Utils.JsPromise<TResult1 | TResult2>
    /**
     * Attaches a callback for only the rejection of the Promise.
     * @param onrejected The callback to execute when the Promise is rejected.
     * @returns A Promise for the completion of the callback.
     */
    catch<TResult = never>(onrejected?: ((reason: any) => TResult | PromiseLike<TResult>) | undefined | null): $Utils.JsPromise<T | TResult>
    /**
     * Attaches a callback that is invoked when the Promise is settled (fulfilled or rejected). The
     * resolved value cannot be modified from the callback.
     * @param onfinally The callback to execute when the Promise is settled (fulfilled or rejected).
     * @returns A Promise for the completion of the callback.
     */
    finally(onfinally?: (() => void) | undefined | null): $Utils.JsPromise<T>
  }




  /**
   * Fields of the agent_lab_configs model
   */ 
  interface agent_lab_configsFieldRefs {
    readonly id: FieldRef<"agent_lab_configs", 'String'>
    readonly agentName: FieldRef<"agent_lab_configs", 'String'>
    readonly model: FieldRef<"agent_lab_configs", 'String'>
    readonly temperature: FieldRef<"agent_lab_configs", 'Float'>
    readonly maxTokens: FieldRef<"agent_lab_configs", 'Int'>
    readonly baseURL: FieldRef<"agent_lab_configs", 'String'>
    readonly apiKey: FieldRef<"agent_lab_configs", 'String'>
    readonly systemPrompt: FieldRef<"agent_lab_configs", 'String'>
    readonly extraConfig: FieldRef<"agent_lab_configs", 'String'>
    readonly createdAt: FieldRef<"agent_lab_configs", 'DateTime'>
    readonly updatedAt: FieldRef<"agent_lab_configs", 'DateTime'>
  }
    

  // Custom InputTypes
  /**
   * agent_lab_configs findUnique
   */
  export type agent_lab_configsFindUniqueArgs<ExtArgs extends $Extensions.InternalArgs = $Extensions.DefaultArgs> = {
    /**
     * Select specific fields to fetch from the agent_lab_configs
     */
    select?: agent_lab_configsSelect<ExtArgs> | null
    /**
     * Filter, which agent_lab_configs to fetch.
     */
    where: agent_lab_configsWhereUniqueInput
  }

  /**
   * agent_lab_configs findUniqueOrThrow
   */
  export type agent_lab_configsFindUniqueOrThrowArgs<ExtArgs extends $Extensions.InternalArgs = $Extensions.DefaultArgs> = {
    /**
     * Select specific fields to fetch from the agent_lab_configs
     */
    select?: agent_lab_configsSelect<ExtArgs> | null
    /**
     * Filter, which agent_lab_configs to fetch.
     */
    where: agent_lab_configsWhereUniqueInput
  }

  /**
   * agent_lab_configs findFirst
   */
  export type agent_lab_configsFindFirstArgs<ExtArgs extends $Extensions.InternalArgs = $Extensions.DefaultArgs> = {
    /**
     * Select specific fields to fetch from the agent_lab_configs
     */
    select?: agent_lab_configsSelect<ExtArgs> | null
    /**
     * Filter, which agent_lab_configs to fetch.
     */
    where?: agent_lab_configsWhereInput
    /**
     * {@link https://www.prisma.io/docs/concepts/components/prisma-client/sorting Sorting Docs}
     * 
     * Determine the order of agent_lab_configs to fetch.
     */
    orderBy?: agent_lab_configsOrderByWithRelationInput | agent_lab_configsOrderByWithRelationInput[]
    /**
     * {@link https://www.prisma.io/docs/concepts/components/prisma-client/pagination#cursor-based-pagination Cursor Docs}
     * 
     * Sets the position for searching for agent_lab_configs.
     */
    cursor?: agent_lab_configsWhereUniqueInput
    /**
     * {@link https://www.prisma.io/docs/concepts/components/prisma-client/pagination Pagination Docs}
     * 
     * Take `±n` agent_lab_configs from the position of the cursor.
     */
    take?: number
    /**
     * {@link https://www.prisma.io/docs/concepts/components/prisma-client/pagination Pagination Docs}
     * 
     * Skip the first `n` agent_lab_configs.
     */
    skip?: number
    /**
     * {@link https://www.prisma.io/docs/concepts/components/prisma-client/distinct Distinct Docs}
     * 
     * Filter by unique combinations of agent_lab_configs.
     */
    distinct?: Agent_lab_configsScalarFieldEnum | Agent_lab_configsScalarFieldEnum[]
  }

  /**
   * agent_lab_configs findFirstOrThrow
   */
  export type agent_lab_configsFindFirstOrThrowArgs<ExtArgs extends $Extensions.InternalArgs = $Extensions.DefaultArgs> = {
    /**
     * Select specific fields to fetch from the agent_lab_configs
     */
    select?: agent_lab_configsSelect<ExtArgs> | null
    /**
     * Filter, which agent_lab_configs to fetch.
     */
    where?: agent_lab_configsWhereInput
    /**
     * {@link https://www.prisma.io/docs/concepts/components/prisma-client/sorting Sorting Docs}
     * 
     * Determine the order of agent_lab_configs to fetch.
     */
    orderBy?: agent_lab_configsOrderByWithRelationInput | agent_lab_configsOrderByWithRelationInput[]
    /**
     * {@link https://www.prisma.io/docs/concepts/components/prisma-client/pagination#cursor-based-pagination Cursor Docs}
     * 
     * Sets the position for searching for agent_lab_configs.
     */
    cursor?: agent_lab_configsWhereUniqueInput
    /**
     * {@link https://www.prisma.io/docs/concepts/components/prisma-client/pagination Pagination Docs}
     * 
     * Take `±n` agent_lab_configs from the position of the cursor.
     */
    take?: number
    /**
     * {@link https://www.prisma.io/docs/concepts/components/prisma-client/pagination Pagination Docs}
     * 
     * Skip the first `n` agent_lab_configs.
     */
    skip?: number
    /**
     * {@link https://www.prisma.io/docs/concepts/components/prisma-client/distinct Distinct Docs}
     * 
     * Filter by unique combinations of agent_lab_configs.
     */
    distinct?: Agent_lab_configsScalarFieldEnum | Agent_lab_configsScalarFieldEnum[]
  }

  /**
   * agent_lab_configs findMany
   */
  export type agent_lab_configsFindManyArgs<ExtArgs extends $Extensions.InternalArgs = $Extensions.DefaultArgs> = {
    /**
     * Select specific fields to fetch from the agent_lab_configs
     */
    select?: agent_lab_configsSelect<ExtArgs> | null
    /**
     * Filter, which agent_lab_configs to fetch.
     */
    where?: agent_lab_configsWhereInput
    /**
     * {@link https://www.prisma.io/docs/concepts/components/prisma-client/sorting Sorting Docs}
     * 
     * Determine the order of agent_lab_configs to fetch.
     */
    orderBy?: agent_lab_configsOrderByWithRelationInput | agent_lab_configsOrderByWithRelationInput[]
    /**
     * {@link https://www.prisma.io/docs/concepts/components/prisma-client/pagination#cursor-based-pagination Cursor Docs}
     * 
     * Sets the position for listing agent_lab_configs.
     */
    cursor?: agent_lab_configsWhereUniqueInput
    /**
     * {@link https://www.prisma.io/docs/concepts/components/prisma-client/pagination Pagination Docs}
     * 
     * Take `±n` agent_lab_configs from the position of the cursor.
     */
    take?: number
    /**
     * {@link https://www.prisma.io/docs/concepts/components/prisma-client/pagination Pagination Docs}
     * 
     * Skip the first `n` agent_lab_configs.
     */
    skip?: number
    distinct?: Agent_lab_configsScalarFieldEnum | Agent_lab_configsScalarFieldEnum[]
  }

  /**
   * agent_lab_configs create
   */
  export type agent_lab_configsCreateArgs<ExtArgs extends $Extensions.InternalArgs = $Extensions.DefaultArgs> = {
    /**
     * Select specific fields to fetch from the agent_lab_configs
     */
    select?: agent_lab_configsSelect<ExtArgs> | null
    /**
     * The data needed to create a agent_lab_configs.
     */
    data: XOR<agent_lab_configsCreateInput, agent_lab_configsUncheckedCreateInput>
  }

  /**
   * agent_lab_configs createMany
   */
  export type agent_lab_configsCreateManyArgs<ExtArgs extends $Extensions.InternalArgs = $Extensions.DefaultArgs> = {
    /**
     * The data used to create many agent_lab_configs.
     */
    data: agent_lab_configsCreateManyInput | agent_lab_configsCreateManyInput[]
  }

  /**
   * agent_lab_configs createManyAndReturn
   */
  export type agent_lab_configsCreateManyAndReturnArgs<ExtArgs extends $Extensions.InternalArgs = $Extensions.DefaultArgs> = {
    /**
     * Select specific fields to fetch from the agent_lab_configs
     */
    select?: agent_lab_configsSelectCreateManyAndReturn<ExtArgs> | null
    /**
     * The data used to create many agent_lab_configs.
     */
    data: agent_lab_configsCreateManyInput | agent_lab_configsCreateManyInput[]
  }

  /**
   * agent_lab_configs update
   */
  export type agent_lab_configsUpdateArgs<ExtArgs extends $Extensions.InternalArgs = $Extensions.DefaultArgs> = {
    /**
     * Select specific fields to fetch from the agent_lab_configs
     */
    select?: agent_lab_configsSelect<ExtArgs> | null
    /**
     * The data needed to update a agent_lab_configs.
     */
    data: XOR<agent_lab_configsUpdateInput, agent_lab_configsUncheckedUpdateInput>
    /**
     * Choose, which agent_lab_configs to update.
     */
    where: agent_lab_configsWhereUniqueInput
  }

  /**
   * agent_lab_configs updateMany
   */
  export type agent_lab_configsUpdateManyArgs<ExtArgs extends $Extensions.InternalArgs = $Extensions.DefaultArgs> = {
    /**
     * The data used to update agent_lab_configs.
     */
    data: XOR<agent_lab_configsUpdateManyMutationInput, agent_lab_configsUncheckedUpdateManyInput>
    /**
     * Filter which agent_lab_configs to update
     */
    where?: agent_lab_configsWhereInput
  }

  /**
   * agent_lab_configs upsert
   */
  export type agent_lab_configsUpsertArgs<ExtArgs extends $Extensions.InternalArgs = $Extensions.DefaultArgs> = {
    /**
     * Select specific fields to fetch from the agent_lab_configs
     */
    select?: agent_lab_configsSelect<ExtArgs> | null
    /**
     * The filter to search for the agent_lab_configs to update in case it exists.
     */
    where: agent_lab_configsWhereUniqueInput
    /**
     * In case the agent_lab_configs found by the `where` argument doesn't exist, create a new agent_lab_configs with this data.
     */
    create: XOR<agent_lab_configsCreateInput, agent_lab_configsUncheckedCreateInput>
    /**
     * In case the agent_lab_configs was found with the provided `where` argument, update it with this data.
     */
    update: XOR<agent_lab_configsUpdateInput, agent_lab_configsUncheckedUpdateInput>
  }

  /**
   * agent_lab_configs delete
   */
  export type agent_lab_configsDeleteArgs<ExtArgs extends $Extensions.InternalArgs = $Extensions.DefaultArgs> = {
    /**
     * Select specific fields to fetch from the agent_lab_configs
     */
    select?: agent_lab_configsSelect<ExtArgs> | null
    /**
     * Filter which agent_lab_configs to delete.
     */
    where: agent_lab_configsWhereUniqueInput
  }

  /**
   * agent_lab_configs deleteMany
   */
  export type agent_lab_configsDeleteManyArgs<ExtArgs extends $Extensions.InternalArgs = $Extensions.DefaultArgs> = {
    /**
     * Filter which agent_lab_configs to delete
     */
    where?: agent_lab_configsWhereInput
  }

  /**
   * agent_lab_configs without action
   */
  export type agent_lab_configsDefaultArgs<ExtArgs extends $Extensions.InternalArgs = $Extensions.DefaultArgs> = {
    /**
     * Select specific fields to fetch from the agent_lab_configs
     */
    select?: agent_lab_configsSelect<ExtArgs> | null
  }


  /**
   * Model agent_model_configs
   */

  export type AggregateAgent_model_configs = {
    _count: Agent_model_configsCountAggregateOutputType | null
    _avg: Agent_model_configsAvgAggregateOutputType | null
    _sum: Agent_model_configsSumAggregateOutputType | null
    _min: Agent_model_configsMinAggregateOutputType | null
    _max: Agent_model_configsMaxAggregateOutputType | null
  }

  export type Agent_model_configsAvgAggregateOutputType = {
    temperature: number | null
    maxTokens: number | null
    priority: number | null
  }

  export type Agent_model_configsSumAggregateOutputType = {
    temperature: number | null
    maxTokens: number | null
    priority: number | null
  }

  export type Agent_model_configsMinAggregateOutputType = {
    id: string | null
    agentId: string | null
    tier: string | null
    model: string | null
    endpoint: string | null
    apiKey: string | null
    temperature: number | null
    maxTokens: number | null
    priority: number | null
    enabled: boolean | null
    createdAt: Date | null
    updatedAt: Date | null
    reasoningEffort: string | null
    thinkingMode: string | null
  }

  export type Agent_model_configsMaxAggregateOutputType = {
    id: string | null
    agentId: string | null
    tier: string | null
    model: string | null
    endpoint: string | null
    apiKey: string | null
    temperature: number | null
    maxTokens: number | null
    priority: number | null
    enabled: boolean | null
    createdAt: Date | null
    updatedAt: Date | null
    reasoningEffort: string | null
    thinkingMode: string | null
  }

  export type Agent_model_configsCountAggregateOutputType = {
    id: number
    agentId: number
    tier: number
    model: number
    endpoint: number
    apiKey: number
    temperature: number
    maxTokens: number
    priority: number
    enabled: number
    createdAt: number
    updatedAt: number
    reasoningEffort: number
    thinkingMode: number
    _all: number
  }


  export type Agent_model_configsAvgAggregateInputType = {
    temperature?: true
    maxTokens?: true
    priority?: true
  }

  export type Agent_model_configsSumAggregateInputType = {
    temperature?: true
    maxTokens?: true
    priority?: true
  }

  export type Agent_model_configsMinAggregateInputType = {
    id?: true
    agentId?: true
    tier?: true
    model?: true
    endpoint?: true
    apiKey?: true
    temperature?: true
    maxTokens?: true
    priority?: true
    enabled?: true
    createdAt?: true
    updatedAt?: true
    reasoningEffort?: true
    thinkingMode?: true
  }

  export type Agent_model_configsMaxAggregateInputType = {
    id?: true
    agentId?: true
    tier?: true
    model?: true
    endpoint?: true
    apiKey?: true
    temperature?: true
    maxTokens?: true
    priority?: true
    enabled?: true
    createdAt?: true
    updatedAt?: true
    reasoningEffort?: true
    thinkingMode?: true
  }

  export type Agent_model_configsCountAggregateInputType = {
    id?: true
    agentId?: true
    tier?: true
    model?: true
    endpoint?: true
    apiKey?: true
    temperature?: true
    maxTokens?: true
    priority?: true
    enabled?: true
    createdAt?: true
    updatedAt?: true
    reasoningEffort?: true
    thinkingMode?: true
    _all?: true
  }

  export type Agent_model_configsAggregateArgs<ExtArgs extends $Extensions.InternalArgs = $Extensions.DefaultArgs> = {
    /**
     * Filter which agent_model_configs to aggregate.
     */
    where?: agent_model_configsWhereInput
    /**
     * {@link https://www.prisma.io/docs/concepts/components/prisma-client/sorting Sorting Docs}
     * 
     * Determine the order of agent_model_configs to fetch.
     */
    orderBy?: agent_model_configsOrderByWithRelationInput | agent_model_configsOrderByWithRelationInput[]
    /**
     * {@link https://www.prisma.io/docs/concepts/components/prisma-client/pagination#cursor-based-pagination Cursor Docs}
     * 
     * Sets the start position
     */
    cursor?: agent_model_configsWhereUniqueInput
    /**
     * {@link https://www.prisma.io/docs/concepts/components/prisma-client/pagination Pagination Docs}
     * 
     * Take `±n` agent_model_configs from the position of the cursor.
     */
    take?: number
    /**
     * {@link https://www.prisma.io/docs/concepts/components/prisma-client/pagination Pagination Docs}
     * 
     * Skip the first `n` agent_model_configs.
     */
    skip?: number
    /**
     * {@link https://www.prisma.io/docs/concepts/components/prisma-client/aggregations Aggregation Docs}
     * 
     * Count returned agent_model_configs
    **/
    _count?: true | Agent_model_configsCountAggregateInputType
    /**
     * {@link https://www.prisma.io/docs/concepts/components/prisma-client/aggregations Aggregation Docs}
     * 
     * Select which fields to average
    **/
    _avg?: Agent_model_configsAvgAggregateInputType
    /**
     * {@link https://www.prisma.io/docs/concepts/components/prisma-client/aggregations Aggregation Docs}
     * 
     * Select which fields to sum
    **/
    _sum?: Agent_model_configsSumAggregateInputType
    /**
     * {@link https://www.prisma.io/docs/concepts/components/prisma-client/aggregations Aggregation Docs}
     * 
     * Select which fields to find the minimum value
    **/
    _min?: Agent_model_configsMinAggregateInputType
    /**
     * {@link https://www.prisma.io/docs/concepts/components/prisma-client/aggregations Aggregation Docs}
     * 
     * Select which fields to find the maximum value
    **/
    _max?: Agent_model_configsMaxAggregateInputType
  }

  export type GetAgent_model_configsAggregateType<T extends Agent_model_configsAggregateArgs> = {
        [P in keyof T & keyof AggregateAgent_model_configs]: P extends '_count' | 'count'
      ? T[P] extends true
        ? number
        : GetScalarType<T[P], AggregateAgent_model_configs[P]>
      : GetScalarType<T[P], AggregateAgent_model_configs[P]>
  }




  export type agent_model_configsGroupByArgs<ExtArgs extends $Extensions.InternalArgs = $Extensions.DefaultArgs> = {
    where?: agent_model_configsWhereInput
    orderBy?: agent_model_configsOrderByWithAggregationInput | agent_model_configsOrderByWithAggregationInput[]
    by: Agent_model_configsScalarFieldEnum[] | Agent_model_configsScalarFieldEnum
    having?: agent_model_configsScalarWhereWithAggregatesInput
    take?: number
    skip?: number
    _count?: Agent_model_configsCountAggregateInputType | true
    _avg?: Agent_model_configsAvgAggregateInputType
    _sum?: Agent_model_configsSumAggregateInputType
    _min?: Agent_model_configsMinAggregateInputType
    _max?: Agent_model_configsMaxAggregateInputType
  }

  export type Agent_model_configsGroupByOutputType = {
    id: string
    agentId: string
    tier: string
    model: string | null
    endpoint: string | null
    apiKey: string | null
    temperature: number
    maxTokens: number
    priority: number
    enabled: boolean
    createdAt: Date
    updatedAt: Date
    reasoningEffort: string | null
    thinkingMode: string | null
    _count: Agent_model_configsCountAggregateOutputType | null
    _avg: Agent_model_configsAvgAggregateOutputType | null
    _sum: Agent_model_configsSumAggregateOutputType | null
    _min: Agent_model_configsMinAggregateOutputType | null
    _max: Agent_model_configsMaxAggregateOutputType | null
  }

  type GetAgent_model_configsGroupByPayload<T extends agent_model_configsGroupByArgs> = Prisma.PrismaPromise<
    Array<
      PickEnumerable<Agent_model_configsGroupByOutputType, T['by']> &
        {
          [P in ((keyof T) & (keyof Agent_model_configsGroupByOutputType))]: P extends '_count'
            ? T[P] extends boolean
              ? number
              : GetScalarType<T[P], Agent_model_configsGroupByOutputType[P]>
            : GetScalarType<T[P], Agent_model_configsGroupByOutputType[P]>
        }
      >
    >


  export type agent_model_configsSelect<ExtArgs extends $Extensions.InternalArgs = $Extensions.DefaultArgs> = $Extensions.GetSelect<{
    id?: boolean
    agentId?: boolean
    tier?: boolean
    model?: boolean
    endpoint?: boolean
    apiKey?: boolean
    temperature?: boolean
    maxTokens?: boolean
    priority?: boolean
    enabled?: boolean
    createdAt?: boolean
    updatedAt?: boolean
    reasoningEffort?: boolean
    thinkingMode?: boolean
  }, ExtArgs["result"]["agent_model_configs"]>

  export type agent_model_configsSelectCreateManyAndReturn<ExtArgs extends $Extensions.InternalArgs = $Extensions.DefaultArgs> = $Extensions.GetSelect<{
    id?: boolean
    agentId?: boolean
    tier?: boolean
    model?: boolean
    endpoint?: boolean
    apiKey?: boolean
    temperature?: boolean
    maxTokens?: boolean
    priority?: boolean
    enabled?: boolean
    createdAt?: boolean
    updatedAt?: boolean
    reasoningEffort?: boolean
    thinkingMode?: boolean
  }, ExtArgs["result"]["agent_model_configs"]>

  export type agent_model_configsSelectScalar = {
    id?: boolean
    agentId?: boolean
    tier?: boolean
    model?: boolean
    endpoint?: boolean
    apiKey?: boolean
    temperature?: boolean
    maxTokens?: boolean
    priority?: boolean
    enabled?: boolean
    createdAt?: boolean
    updatedAt?: boolean
    reasoningEffort?: boolean
    thinkingMode?: boolean
  }


  export type $agent_model_configsPayload<ExtArgs extends $Extensions.InternalArgs = $Extensions.DefaultArgs> = {
    name: "agent_model_configs"
    objects: {}
    scalars: $Extensions.GetPayloadResult<{
      id: string
      agentId: string
      tier: string
      model: string | null
      endpoint: string | null
      apiKey: string | null
      temperature: number
      maxTokens: number
      priority: number
      enabled: boolean
      createdAt: Date
      updatedAt: Date
      reasoningEffort: string | null
      thinkingMode: string | null
    }, ExtArgs["result"]["agent_model_configs"]>
    composites: {}
  }

  type agent_model_configsGetPayload<S extends boolean | null | undefined | agent_model_configsDefaultArgs> = $Result.GetResult<Prisma.$agent_model_configsPayload, S>

  type agent_model_configsCountArgs<ExtArgs extends $Extensions.InternalArgs = $Extensions.DefaultArgs> = 
    Omit<agent_model_configsFindManyArgs, 'select' | 'include' | 'distinct'> & {
      select?: Agent_model_configsCountAggregateInputType | true
    }

  export interface agent_model_configsDelegate<ExtArgs extends $Extensions.InternalArgs = $Extensions.DefaultArgs> {
    [K: symbol]: { types: Prisma.TypeMap<ExtArgs>['model']['agent_model_configs'], meta: { name: 'agent_model_configs' } }
    /**
     * Find zero or one Agent_model_configs that matches the filter.
     * @param {agent_model_configsFindUniqueArgs} args - Arguments to find a Agent_model_configs
     * @example
     * // Get one Agent_model_configs
     * const agent_model_configs = await prisma.agent_model_configs.findUnique({
     *   where: {
     *     // ... provide filter here
     *   }
     * })
     */
    findUnique<T extends agent_model_configsFindUniqueArgs>(args: SelectSubset<T, agent_model_configsFindUniqueArgs<ExtArgs>>): Prisma__agent_model_configsClient<$Result.GetResult<Prisma.$agent_model_configsPayload<ExtArgs>, T, "findUnique"> | null, null, ExtArgs>

    /**
     * Find one Agent_model_configs that matches the filter or throw an error with `error.code='P2025'` 
     * if no matches were found.
     * @param {agent_model_configsFindUniqueOrThrowArgs} args - Arguments to find a Agent_model_configs
     * @example
     * // Get one Agent_model_configs
     * const agent_model_configs = await prisma.agent_model_configs.findUniqueOrThrow({
     *   where: {
     *     // ... provide filter here
     *   }
     * })
     */
    findUniqueOrThrow<T extends agent_model_configsFindUniqueOrThrowArgs>(args: SelectSubset<T, agent_model_configsFindUniqueOrThrowArgs<ExtArgs>>): Prisma__agent_model_configsClient<$Result.GetResult<Prisma.$agent_model_configsPayload<ExtArgs>, T, "findUniqueOrThrow">, never, ExtArgs>

    /**
     * Find the first Agent_model_configs that matches the filter.
     * Note, that providing `undefined` is treated as the value not being there.
     * Read more here: https://pris.ly/d/null-undefined
     * @param {agent_model_configsFindFirstArgs} args - Arguments to find a Agent_model_configs
     * @example
     * // Get one Agent_model_configs
     * const agent_model_configs = await prisma.agent_model_configs.findFirst({
     *   where: {
     *     // ... provide filter here
     *   }
     * })
     */
    findFirst<T extends agent_model_configsFindFirstArgs>(args?: SelectSubset<T, agent_model_configsFindFirstArgs<ExtArgs>>): Prisma__agent_model_configsClient<$Result.GetResult<Prisma.$agent_model_configsPayload<ExtArgs>, T, "findFirst"> | null, null, ExtArgs>

    /**
     * Find the first Agent_model_configs that matches the filter or
     * throw `PrismaKnownClientError` with `P2025` code if no matches were found.
     * Note, that providing `undefined` is treated as the value not being there.
     * Read more here: https://pris.ly/d/null-undefined
     * @param {agent_model_configsFindFirstOrThrowArgs} args - Arguments to find a Agent_model_configs
     * @example
     * // Get one Agent_model_configs
     * const agent_model_configs = await prisma.agent_model_configs.findFirstOrThrow({
     *   where: {
     *     // ... provide filter here
     *   }
     * })
     */
    findFirstOrThrow<T extends agent_model_configsFindFirstOrThrowArgs>(args?: SelectSubset<T, agent_model_configsFindFirstOrThrowArgs<ExtArgs>>): Prisma__agent_model_configsClient<$Result.GetResult<Prisma.$agent_model_configsPayload<ExtArgs>, T, "findFirstOrThrow">, never, ExtArgs>

    /**
     * Find zero or more Agent_model_configs that matches the filter.
     * Note, that providing `undefined` is treated as the value not being there.
     * Read more here: https://pris.ly/d/null-undefined
     * @param {agent_model_configsFindManyArgs} args - Arguments to filter and select certain fields only.
     * @example
     * // Get all Agent_model_configs
     * const agent_model_configs = await prisma.agent_model_configs.findMany()
     * 
     * // Get first 10 Agent_model_configs
     * const agent_model_configs = await prisma.agent_model_configs.findMany({ take: 10 })
     * 
     * // Only select the `id`
     * const agent_model_configsWithIdOnly = await prisma.agent_model_configs.findMany({ select: { id: true } })
     * 
     */
    findMany<T extends agent_model_configsFindManyArgs>(args?: SelectSubset<T, agent_model_configsFindManyArgs<ExtArgs>>): Prisma.PrismaPromise<$Result.GetResult<Prisma.$agent_model_configsPayload<ExtArgs>, T, "findMany">>

    /**
     * Create a Agent_model_configs.
     * @param {agent_model_configsCreateArgs} args - Arguments to create a Agent_model_configs.
     * @example
     * // Create one Agent_model_configs
     * const Agent_model_configs = await prisma.agent_model_configs.create({
     *   data: {
     *     // ... data to create a Agent_model_configs
     *   }
     * })
     * 
     */
    create<T extends agent_model_configsCreateArgs>(args: SelectSubset<T, agent_model_configsCreateArgs<ExtArgs>>): Prisma__agent_model_configsClient<$Result.GetResult<Prisma.$agent_model_configsPayload<ExtArgs>, T, "create">, never, ExtArgs>

    /**
     * Create many Agent_model_configs.
     * @param {agent_model_configsCreateManyArgs} args - Arguments to create many Agent_model_configs.
     * @example
     * // Create many Agent_model_configs
     * const agent_model_configs = await prisma.agent_model_configs.createMany({
     *   data: [
     *     // ... provide data here
     *   ]
     * })
     *     
     */
    createMany<T extends agent_model_configsCreateManyArgs>(args?: SelectSubset<T, agent_model_configsCreateManyArgs<ExtArgs>>): Prisma.PrismaPromise<BatchPayload>

    /**
     * Create many Agent_model_configs and returns the data saved in the database.
     * @param {agent_model_configsCreateManyAndReturnArgs} args - Arguments to create many Agent_model_configs.
     * @example
     * // Create many Agent_model_configs
     * const agent_model_configs = await prisma.agent_model_configs.createManyAndReturn({
     *   data: [
     *     // ... provide data here
     *   ]
     * })
     * 
     * // Create many Agent_model_configs and only return the `id`
     * const agent_model_configsWithIdOnly = await prisma.agent_model_configs.createManyAndReturn({ 
     *   select: { id: true },
     *   data: [
     *     // ... provide data here
     *   ]
     * })
     * Note, that providing `undefined` is treated as the value not being there.
     * Read more here: https://pris.ly/d/null-undefined
     * 
     */
    createManyAndReturn<T extends agent_model_configsCreateManyAndReturnArgs>(args?: SelectSubset<T, agent_model_configsCreateManyAndReturnArgs<ExtArgs>>): Prisma.PrismaPromise<$Result.GetResult<Prisma.$agent_model_configsPayload<ExtArgs>, T, "createManyAndReturn">>

    /**
     * Delete a Agent_model_configs.
     * @param {agent_model_configsDeleteArgs} args - Arguments to delete one Agent_model_configs.
     * @example
     * // Delete one Agent_model_configs
     * const Agent_model_configs = await prisma.agent_model_configs.delete({
     *   where: {
     *     // ... filter to delete one Agent_model_configs
     *   }
     * })
     * 
     */
    delete<T extends agent_model_configsDeleteArgs>(args: SelectSubset<T, agent_model_configsDeleteArgs<ExtArgs>>): Prisma__agent_model_configsClient<$Result.GetResult<Prisma.$agent_model_configsPayload<ExtArgs>, T, "delete">, never, ExtArgs>

    /**
     * Update one Agent_model_configs.
     * @param {agent_model_configsUpdateArgs} args - Arguments to update one Agent_model_configs.
     * @example
     * // Update one Agent_model_configs
     * const agent_model_configs = await prisma.agent_model_configs.update({
     *   where: {
     *     // ... provide filter here
     *   },
     *   data: {
     *     // ... provide data here
     *   }
     * })
     * 
     */
    update<T extends agent_model_configsUpdateArgs>(args: SelectSubset<T, agent_model_configsUpdateArgs<ExtArgs>>): Prisma__agent_model_configsClient<$Result.GetResult<Prisma.$agent_model_configsPayload<ExtArgs>, T, "update">, never, ExtArgs>

    /**
     * Delete zero or more Agent_model_configs.
     * @param {agent_model_configsDeleteManyArgs} args - Arguments to filter Agent_model_configs to delete.
     * @example
     * // Delete a few Agent_model_configs
     * const { count } = await prisma.agent_model_configs.deleteMany({
     *   where: {
     *     // ... provide filter here
     *   }
     * })
     * 
     */
    deleteMany<T extends agent_model_configsDeleteManyArgs>(args?: SelectSubset<T, agent_model_configsDeleteManyArgs<ExtArgs>>): Prisma.PrismaPromise<BatchPayload>

    /**
     * Update zero or more Agent_model_configs.
     * Note, that providing `undefined` is treated as the value not being there.
     * Read more here: https://pris.ly/d/null-undefined
     * @param {agent_model_configsUpdateManyArgs} args - Arguments to update one or more rows.
     * @example
     * // Update many Agent_model_configs
     * const agent_model_configs = await prisma.agent_model_configs.updateMany({
     *   where: {
     *     // ... provide filter here
     *   },
     *   data: {
     *     // ... provide data here
     *   }
     * })
     * 
     */
    updateMany<T extends agent_model_configsUpdateManyArgs>(args: SelectSubset<T, agent_model_configsUpdateManyArgs<ExtArgs>>): Prisma.PrismaPromise<BatchPayload>

    /**
     * Create or update one Agent_model_configs.
     * @param {agent_model_configsUpsertArgs} args - Arguments to update or create a Agent_model_configs.
     * @example
     * // Update or create a Agent_model_configs
     * const agent_model_configs = await prisma.agent_model_configs.upsert({
     *   create: {
     *     // ... data to create a Agent_model_configs
     *   },
     *   update: {
     *     // ... in case it already exists, update
     *   },
     *   where: {
     *     // ... the filter for the Agent_model_configs we want to update
     *   }
     * })
     */
    upsert<T extends agent_model_configsUpsertArgs>(args: SelectSubset<T, agent_model_configsUpsertArgs<ExtArgs>>): Prisma__agent_model_configsClient<$Result.GetResult<Prisma.$agent_model_configsPayload<ExtArgs>, T, "upsert">, never, ExtArgs>


    /**
     * Count the number of Agent_model_configs.
     * Note, that providing `undefined` is treated as the value not being there.
     * Read more here: https://pris.ly/d/null-undefined
     * @param {agent_model_configsCountArgs} args - Arguments to filter Agent_model_configs to count.
     * @example
     * // Count the number of Agent_model_configs
     * const count = await prisma.agent_model_configs.count({
     *   where: {
     *     // ... the filter for the Agent_model_configs we want to count
     *   }
     * })
    **/
    count<T extends agent_model_configsCountArgs>(
      args?: Subset<T, agent_model_configsCountArgs>,
    ): Prisma.PrismaPromise<
      T extends $Utils.Record<'select', any>
        ? T['select'] extends true
          ? number
          : GetScalarType<T['select'], Agent_model_configsCountAggregateOutputType>
        : number
    >

    /**
     * Allows you to perform aggregations operations on a Agent_model_configs.
     * Note, that providing `undefined` is treated as the value not being there.
     * Read more here: https://pris.ly/d/null-undefined
     * @param {Agent_model_configsAggregateArgs} args - Select which aggregations you would like to apply and on what fields.
     * @example
     * // Ordered by age ascending
     * // Where email contains prisma.io
     * // Limited to the 10 users
     * const aggregations = await prisma.user.aggregate({
     *   _avg: {
     *     age: true,
     *   },
     *   where: {
     *     email: {
     *       contains: "prisma.io",
     *     },
     *   },
     *   orderBy: {
     *     age: "asc",
     *   },
     *   take: 10,
     * })
    **/
    aggregate<T extends Agent_model_configsAggregateArgs>(args: Subset<T, Agent_model_configsAggregateArgs>): Prisma.PrismaPromise<GetAgent_model_configsAggregateType<T>>

    /**
     * Group by Agent_model_configs.
     * Note, that providing `undefined` is treated as the value not being there.
     * Read more here: https://pris.ly/d/null-undefined
     * @param {agent_model_configsGroupByArgs} args - Group by arguments.
     * @example
     * // Group by city, order by createdAt, get count
     * const result = await prisma.user.groupBy({
     *   by: ['city', 'createdAt'],
     *   orderBy: {
     *     createdAt: true
     *   },
     *   _count: {
     *     _all: true
     *   },
     * })
     * 
    **/
    groupBy<
      T extends agent_model_configsGroupByArgs,
      HasSelectOrTake extends Or<
        Extends<'skip', Keys<T>>,
        Extends<'take', Keys<T>>
      >,
      OrderByArg extends True extends HasSelectOrTake
        ? { orderBy: agent_model_configsGroupByArgs['orderBy'] }
        : { orderBy?: agent_model_configsGroupByArgs['orderBy'] },
      OrderFields extends ExcludeUnderscoreKeys<Keys<MaybeTupleToUnion<T['orderBy']>>>,
      ByFields extends MaybeTupleToUnion<T['by']>,
      ByValid extends Has<ByFields, OrderFields>,
      HavingFields extends GetHavingFields<T['having']>,
      HavingValid extends Has<ByFields, HavingFields>,
      ByEmpty extends T['by'] extends never[] ? True : False,
      InputErrors extends ByEmpty extends True
      ? `Error: "by" must not be empty.`
      : HavingValid extends False
      ? {
          [P in HavingFields]: P extends ByFields
            ? never
            : P extends string
            ? `Error: Field "${P}" used in "having" needs to be provided in "by".`
            : [
                Error,
                'Field ',
                P,
                ` in "having" needs to be provided in "by"`,
              ]
        }[HavingFields]
      : 'take' extends Keys<T>
      ? 'orderBy' extends Keys<T>
        ? ByValid extends True
          ? {}
          : {
              [P in OrderFields]: P extends ByFields
                ? never
                : `Error: Field "${P}" in "orderBy" needs to be provided in "by"`
            }[OrderFields]
        : 'Error: If you provide "take", you also need to provide "orderBy"'
      : 'skip' extends Keys<T>
      ? 'orderBy' extends Keys<T>
        ? ByValid extends True
          ? {}
          : {
              [P in OrderFields]: P extends ByFields
                ? never
                : `Error: Field "${P}" in "orderBy" needs to be provided in "by"`
            }[OrderFields]
        : 'Error: If you provide "skip", you also need to provide "orderBy"'
      : ByValid extends True
      ? {}
      : {
          [P in OrderFields]: P extends ByFields
            ? never
            : `Error: Field "${P}" in "orderBy" needs to be provided in "by"`
        }[OrderFields]
    >(args: SubsetIntersection<T, agent_model_configsGroupByArgs, OrderByArg> & InputErrors): {} extends InputErrors ? GetAgent_model_configsGroupByPayload<T> : Prisma.PrismaPromise<InputErrors>
  /**
   * Fields of the agent_model_configs model
   */
  readonly fields: agent_model_configsFieldRefs;
  }

  /**
   * The delegate class that acts as a "Promise-like" for agent_model_configs.
   * Why is this prefixed with `Prisma__`?
   * Because we want to prevent naming conflicts as mentioned in
   * https://github.com/prisma/prisma-client-js/issues/707
   */
  export interface Prisma__agent_model_configsClient<T, Null = never, ExtArgs extends $Extensions.InternalArgs = $Extensions.DefaultArgs> extends Prisma.PrismaPromise<T> {
    readonly [Symbol.toStringTag]: "PrismaPromise"
    /**
     * Attaches callbacks for the resolution and/or rejection of the Promise.
     * @param onfulfilled The callback to execute when the Promise is resolved.
     * @param onrejected The callback to execute when the Promise is rejected.
     * @returns A Promise for the completion of which ever callback is executed.
     */
    then<TResult1 = T, TResult2 = never>(onfulfilled?: ((value: T) => TResult1 | PromiseLike<TResult1>) | undefined | null, onrejected?: ((reason: any) => TResult2 | PromiseLike<TResult2>) | undefined | null): $Utils.JsPromise<TResult1 | TResult2>
    /**
     * Attaches a callback for only the rejection of the Promise.
     * @param onrejected The callback to execute when the Promise is rejected.
     * @returns A Promise for the completion of the callback.
     */
    catch<TResult = never>(onrejected?: ((reason: any) => TResult | PromiseLike<TResult>) | undefined | null): $Utils.JsPromise<T | TResult>
    /**
     * Attaches a callback that is invoked when the Promise is settled (fulfilled or rejected). The
     * resolved value cannot be modified from the callback.
     * @param onfinally The callback to execute when the Promise is settled (fulfilled or rejected).
     * @returns A Promise for the completion of the callback.
     */
    finally(onfinally?: (() => void) | undefined | null): $Utils.JsPromise<T>
  }




  /**
   * Fields of the agent_model_configs model
   */ 
  interface agent_model_configsFieldRefs {
    readonly id: FieldRef<"agent_model_configs", 'String'>
    readonly agentId: FieldRef<"agent_model_configs", 'String'>
    readonly tier: FieldRef<"agent_model_configs", 'String'>
    readonly model: FieldRef<"agent_model_configs", 'String'>
    readonly endpoint: FieldRef<"agent_model_configs", 'String'>
    readonly apiKey: FieldRef<"agent_model_configs", 'String'>
    readonly temperature: FieldRef<"agent_model_configs", 'Float'>
    readonly maxTokens: FieldRef<"agent_model_configs", 'Int'>
    readonly priority: FieldRef<"agent_model_configs", 'Int'>
    readonly enabled: FieldRef<"agent_model_configs", 'Boolean'>
    readonly createdAt: FieldRef<"agent_model_configs", 'DateTime'>
    readonly updatedAt: FieldRef<"agent_model_configs", 'DateTime'>
    readonly reasoningEffort: FieldRef<"agent_model_configs", 'String'>
    readonly thinkingMode: FieldRef<"agent_model_configs", 'String'>
  }
    

  // Custom InputTypes
  /**
   * agent_model_configs findUnique
   */
  export type agent_model_configsFindUniqueArgs<ExtArgs extends $Extensions.InternalArgs = $Extensions.DefaultArgs> = {
    /**
     * Select specific fields to fetch from the agent_model_configs
     */
    select?: agent_model_configsSelect<ExtArgs> | null
    /**
     * Filter, which agent_model_configs to fetch.
     */
    where: agent_model_configsWhereUniqueInput
  }

  /**
   * agent_model_configs findUniqueOrThrow
   */
  export type agent_model_configsFindUniqueOrThrowArgs<ExtArgs extends $Extensions.InternalArgs = $Extensions.DefaultArgs> = {
    /**
     * Select specific fields to fetch from the agent_model_configs
     */
    select?: agent_model_configsSelect<ExtArgs> | null
    /**
     * Filter, which agent_model_configs to fetch.
     */
    where: agent_model_configsWhereUniqueInput
  }

  /**
   * agent_model_configs findFirst
   */
  export type agent_model_configsFindFirstArgs<ExtArgs extends $Extensions.InternalArgs = $Extensions.DefaultArgs> = {
    /**
     * Select specific fields to fetch from the agent_model_configs
     */
    select?: agent_model_configsSelect<ExtArgs> | null
    /**
     * Filter, which agent_model_configs to fetch.
     */
    where?: agent_model_configsWhereInput
    /**
     * {@link https://www.prisma.io/docs/concepts/components/prisma-client/sorting Sorting Docs}
     * 
     * Determine the order of agent_model_configs to fetch.
     */
    orderBy?: agent_model_configsOrderByWithRelationInput | agent_model_configsOrderByWithRelationInput[]
    /**
     * {@link https://www.prisma.io/docs/concepts/components/prisma-client/pagination#cursor-based-pagination Cursor Docs}
     * 
     * Sets the position for searching for agent_model_configs.
     */
    cursor?: agent_model_configsWhereUniqueInput
    /**
     * {@link https://www.prisma.io/docs/concepts/components/prisma-client/pagination Pagination Docs}
     * 
     * Take `±n` agent_model_configs from the position of the cursor.
     */
    take?: number
    /**
     * {@link https://www.prisma.io/docs/concepts/components/prisma-client/pagination Pagination Docs}
     * 
     * Skip the first `n` agent_model_configs.
     */
    skip?: number
    /**
     * {@link https://www.prisma.io/docs/concepts/components/prisma-client/distinct Distinct Docs}
     * 
     * Filter by unique combinations of agent_model_configs.
     */
    distinct?: Agent_model_configsScalarFieldEnum | Agent_model_configsScalarFieldEnum[]
  }

  /**
   * agent_model_configs findFirstOrThrow
   */
  export type agent_model_configsFindFirstOrThrowArgs<ExtArgs extends $Extensions.InternalArgs = $Extensions.DefaultArgs> = {
    /**
     * Select specific fields to fetch from the agent_model_configs
     */
    select?: agent_model_configsSelect<ExtArgs> | null
    /**
     * Filter, which agent_model_configs to fetch.
     */
    where?: agent_model_configsWhereInput
    /**
     * {@link https://www.prisma.io/docs/concepts/components/prisma-client/sorting Sorting Docs}
     * 
     * Determine the order of agent_model_configs to fetch.
     */
    orderBy?: agent_model_configsOrderByWithRelationInput | agent_model_configsOrderByWithRelationInput[]
    /**
     * {@link https://www.prisma.io/docs/concepts/components/prisma-client/pagination#cursor-based-pagination Cursor Docs}
     * 
     * Sets the position for searching for agent_model_configs.
     */
    cursor?: agent_model_configsWhereUniqueInput
    /**
     * {@link https://www.prisma.io/docs/concepts/components/prisma-client/pagination Pagination Docs}
     * 
     * Take `±n` agent_model_configs from the position of the cursor.
     */
    take?: number
    /**
     * {@link https://www.prisma.io/docs/concepts/components/prisma-client/pagination Pagination Docs}
     * 
     * Skip the first `n` agent_model_configs.
     */
    skip?: number
    /**
     * {@link https://www.prisma.io/docs/concepts/components/prisma-client/distinct Distinct Docs}
     * 
     * Filter by unique combinations of agent_model_configs.
     */
    distinct?: Agent_model_configsScalarFieldEnum | Agent_model_configsScalarFieldEnum[]
  }

  /**
   * agent_model_configs findMany
   */
  export type agent_model_configsFindManyArgs<ExtArgs extends $Extensions.InternalArgs = $Extensions.DefaultArgs> = {
    /**
     * Select specific fields to fetch from the agent_model_configs
     */
    select?: agent_model_configsSelect<ExtArgs> | null
    /**
     * Filter, which agent_model_configs to fetch.
     */
    where?: agent_model_configsWhereInput
    /**
     * {@link https://www.prisma.io/docs/concepts/components/prisma-client/sorting Sorting Docs}
     * 
     * Determine the order of agent_model_configs to fetch.
     */
    orderBy?: agent_model_configsOrderByWithRelationInput | agent_model_configsOrderByWithRelationInput[]
    /**
     * {@link https://www.prisma.io/docs/concepts/components/prisma-client/pagination#cursor-based-pagination Cursor Docs}
     * 
     * Sets the position for listing agent_model_configs.
     */
    cursor?: agent_model_configsWhereUniqueInput
    /**
     * {@link https://www.prisma.io/docs/concepts/components/prisma-client/pagination Pagination Docs}
     * 
     * Take `±n` agent_model_configs from the position of the cursor.
     */
    take?: number
    /**
     * {@link https://www.prisma.io/docs/concepts/components/prisma-client/pagination Pagination Docs}
     * 
     * Skip the first `n` agent_model_configs.
     */
    skip?: number
    distinct?: Agent_model_configsScalarFieldEnum | Agent_model_configsScalarFieldEnum[]
  }

  /**
   * agent_model_configs create
   */
  export type agent_model_configsCreateArgs<ExtArgs extends $Extensions.InternalArgs = $Extensions.DefaultArgs> = {
    /**
     * Select specific fields to fetch from the agent_model_configs
     */
    select?: agent_model_configsSelect<ExtArgs> | null
    /**
     * The data needed to create a agent_model_configs.
     */
    data: XOR<agent_model_configsCreateInput, agent_model_configsUncheckedCreateInput>
  }

  /**
   * agent_model_configs createMany
   */
  export type agent_model_configsCreateManyArgs<ExtArgs extends $Extensions.InternalArgs = $Extensions.DefaultArgs> = {
    /**
     * The data used to create many agent_model_configs.
     */
    data: agent_model_configsCreateManyInput | agent_model_configsCreateManyInput[]
  }

  /**
   * agent_model_configs createManyAndReturn
   */
  export type agent_model_configsCreateManyAndReturnArgs<ExtArgs extends $Extensions.InternalArgs = $Extensions.DefaultArgs> = {
    /**
     * Select specific fields to fetch from the agent_model_configs
     */
    select?: agent_model_configsSelectCreateManyAndReturn<ExtArgs> | null
    /**
     * The data used to create many agent_model_configs.
     */
    data: agent_model_configsCreateManyInput | agent_model_configsCreateManyInput[]
  }

  /**
   * agent_model_configs update
   */
  export type agent_model_configsUpdateArgs<ExtArgs extends $Extensions.InternalArgs = $Extensions.DefaultArgs> = {
    /**
     * Select specific fields to fetch from the agent_model_configs
     */
    select?: agent_model_configsSelect<ExtArgs> | null
    /**
     * The data needed to update a agent_model_configs.
     */
    data: XOR<agent_model_configsUpdateInput, agent_model_configsUncheckedUpdateInput>
    /**
     * Choose, which agent_model_configs to update.
     */
    where: agent_model_configsWhereUniqueInput
  }

  /**
   * agent_model_configs updateMany
   */
  export type agent_model_configsUpdateManyArgs<ExtArgs extends $Extensions.InternalArgs = $Extensions.DefaultArgs> = {
    /**
     * The data used to update agent_model_configs.
     */
    data: XOR<agent_model_configsUpdateManyMutationInput, agent_model_configsUncheckedUpdateManyInput>
    /**
     * Filter which agent_model_configs to update
     */
    where?: agent_model_configsWhereInput
  }

  /**
   * agent_model_configs upsert
   */
  export type agent_model_configsUpsertArgs<ExtArgs extends $Extensions.InternalArgs = $Extensions.DefaultArgs> = {
    /**
     * Select specific fields to fetch from the agent_model_configs
     */
    select?: agent_model_configsSelect<ExtArgs> | null
    /**
     * The filter to search for the agent_model_configs to update in case it exists.
     */
    where: agent_model_configsWhereUniqueInput
    /**
     * In case the agent_model_configs found by the `where` argument doesn't exist, create a new agent_model_configs with this data.
     */
    create: XOR<agent_model_configsCreateInput, agent_model_configsUncheckedCreateInput>
    /**
     * In case the agent_model_configs was found with the provided `where` argument, update it with this data.
     */
    update: XOR<agent_model_configsUpdateInput, agent_model_configsUncheckedUpdateInput>
  }

  /**
   * agent_model_configs delete
   */
  export type agent_model_configsDeleteArgs<ExtArgs extends $Extensions.InternalArgs = $Extensions.DefaultArgs> = {
    /**
     * Select specific fields to fetch from the agent_model_configs
     */
    select?: agent_model_configsSelect<ExtArgs> | null
    /**
     * Filter which agent_model_configs to delete.
     */
    where: agent_model_configsWhereUniqueInput
  }

  /**
   * agent_model_configs deleteMany
   */
  export type agent_model_configsDeleteManyArgs<ExtArgs extends $Extensions.InternalArgs = $Extensions.DefaultArgs> = {
    /**
     * Filter which agent_model_configs to delete
     */
    where?: agent_model_configsWhereInput
  }

  /**
   * agent_model_configs without action
   */
  export type agent_model_configsDefaultArgs<ExtArgs extends $Extensions.InternalArgs = $Extensions.DefaultArgs> = {
    /**
     * Select specific fields to fetch from the agent_model_configs
     */
    select?: agent_model_configsSelect<ExtArgs> | null
  }


  /**
   * Model agent_prompts
   */

  export type AggregateAgent_prompts = {
    _count: Agent_promptsCountAggregateOutputType | null
    _avg: Agent_promptsAvgAggregateOutputType | null
    _sum: Agent_promptsSumAggregateOutputType | null
    _min: Agent_promptsMinAggregateOutputType | null
    _max: Agent_promptsMaxAggregateOutputType | null
  }

  export type Agent_promptsAvgAggregateOutputType = {
    version: number | null
    temperature: number | null
    maxTokens: number | null
    useCount: number | null
    avgLatency: number | null
    successRate: number | null
  }

  export type Agent_promptsSumAggregateOutputType = {
    version: number | null
    temperature: number | null
    maxTokens: number | null
    useCount: number | null
    avgLatency: number | null
    successRate: number | null
  }

  export type Agent_promptsMinAggregateOutputType = {
    id: string | null
    agentId: string | null
    version: number | null
    name: string | null
    description: string | null
    systemPrompt: string | null
    compiledSystemPrompt: string | null
    compileStatus: string | null
    compileError: string | null
    sourceHash: string | null
    compileContextHash: string | null
    compiledAt: Date | null
    temperature: number | null
    maxTokens: number | null
    model: string | null
    status: string | null
    createdBy: string | null
    createdAt: Date | null
    updatedAt: Date | null
    metadata: string | null
    useCount: number | null
    avgLatency: number | null
    successRate: number | null
    publishedAt: Date | null
  }

  export type Agent_promptsMaxAggregateOutputType = {
    id: string | null
    agentId: string | null
    version: number | null
    name: string | null
    description: string | null
    systemPrompt: string | null
    compiledSystemPrompt: string | null
    compileStatus: string | null
    compileError: string | null
    sourceHash: string | null
    compileContextHash: string | null
    compiledAt: Date | null
    temperature: number | null
    maxTokens: number | null
    model: string | null
    status: string | null
    createdBy: string | null
    createdAt: Date | null
    updatedAt: Date | null
    metadata: string | null
    useCount: number | null
    avgLatency: number | null
    successRate: number | null
    publishedAt: Date | null
  }

  export type Agent_promptsCountAggregateOutputType = {
    id: number
    agentId: number
    version: number
    name: number
    description: number
    systemPrompt: number
    compiledSystemPrompt: number
    compileStatus: number
    compileError: number
    sourceHash: number
    compileContextHash: number
    compiledAt: number
    temperature: number
    maxTokens: number
    model: number
    status: number
    createdBy: number
    createdAt: number
    updatedAt: number
    metadata: number
    useCount: number
    avgLatency: number
    successRate: number
    publishedAt: number
    _all: number
  }


  export type Agent_promptsAvgAggregateInputType = {
    version?: true
    temperature?: true
    maxTokens?: true
    useCount?: true
    avgLatency?: true
    successRate?: true
  }

  export type Agent_promptsSumAggregateInputType = {
    version?: true
    temperature?: true
    maxTokens?: true
    useCount?: true
    avgLatency?: true
    successRate?: true
  }

  export type Agent_promptsMinAggregateInputType = {
    id?: true
    agentId?: true
    version?: true
    name?: true
    description?: true
    systemPrompt?: true
    compiledSystemPrompt?: true
    compileStatus?: true
    compileError?: true
    sourceHash?: true
    compileContextHash?: true
    compiledAt?: true
    temperature?: true
    maxTokens?: true
    model?: true
    status?: true
    createdBy?: true
    createdAt?: true
    updatedAt?: true
    metadata?: true
    useCount?: true
    avgLatency?: true
    successRate?: true
    publishedAt?: true
  }

  export type Agent_promptsMaxAggregateInputType = {
    id?: true
    agentId?: true
    version?: true
    name?: true
    description?: true
    systemPrompt?: true
    compiledSystemPrompt?: true
    compileStatus?: true
    compileError?: true
    sourceHash?: true
    compileContextHash?: true
    compiledAt?: true
    temperature?: true
    maxTokens?: true
    model?: true
    status?: true
    createdBy?: true
    createdAt?: true
    updatedAt?: true
    metadata?: true
    useCount?: true
    avgLatency?: true
    successRate?: true
    publishedAt?: true
  }

  export type Agent_promptsCountAggregateInputType = {
    id?: true
    agentId?: true
    version?: true
    name?: true
    description?: true
    systemPrompt?: true
    compiledSystemPrompt?: true
    compileStatus?: true
    compileError?: true
    sourceHash?: true
    compileContextHash?: true
    compiledAt?: true
    temperature?: true
    maxTokens?: true
    model?: true
    status?: true
    createdBy?: true
    createdAt?: true
    updatedAt?: true
    metadata?: true
    useCount?: true
    avgLatency?: true
    successRate?: true
    publishedAt?: true
    _all?: true
  }

  export type Agent_promptsAggregateArgs<ExtArgs extends $Extensions.InternalArgs = $Extensions.DefaultArgs> = {
    /**
     * Filter which agent_prompts to aggregate.
     */
    where?: agent_promptsWhereInput
    /**
     * {@link https://www.prisma.io/docs/concepts/components/prisma-client/sorting Sorting Docs}
     * 
     * Determine the order of agent_prompts to fetch.
     */
    orderBy?: agent_promptsOrderByWithRelationInput | agent_promptsOrderByWithRelationInput[]
    /**
     * {@link https://www.prisma.io/docs/concepts/components/prisma-client/pagination#cursor-based-pagination Cursor Docs}
     * 
     * Sets the start position
     */
    cursor?: agent_promptsWhereUniqueInput
    /**
     * {@link https://www.prisma.io/docs/concepts/components/prisma-client/pagination Pagination Docs}
     * 
     * Take `±n` agent_prompts from the position of the cursor.
     */
    take?: number
    /**
     * {@link https://www.prisma.io/docs/concepts/components/prisma-client/pagination Pagination Docs}
     * 
     * Skip the first `n` agent_prompts.
     */
    skip?: number
    /**
     * {@link https://www.prisma.io/docs/concepts/components/prisma-client/aggregations Aggregation Docs}
     * 
     * Count returned agent_prompts
    **/
    _count?: true | Agent_promptsCountAggregateInputType
    /**
     * {@link https://www.prisma.io/docs/concepts/components/prisma-client/aggregations Aggregation Docs}
     * 
     * Select which fields to average
    **/
    _avg?: Agent_promptsAvgAggregateInputType
    /**
     * {@link https://www.prisma.io/docs/concepts/components/prisma-client/aggregations Aggregation Docs}
     * 
     * Select which fields to sum
    **/
    _sum?: Agent_promptsSumAggregateInputType
    /**
     * {@link https://www.prisma.io/docs/concepts/components/prisma-client/aggregations Aggregation Docs}
     * 
     * Select which fields to find the minimum value
    **/
    _min?: Agent_promptsMinAggregateInputType
    /**
     * {@link https://www.prisma.io/docs/concepts/components/prisma-client/aggregations Aggregation Docs}
     * 
     * Select which fields to find the maximum value
    **/
    _max?: Agent_promptsMaxAggregateInputType
  }

  export type GetAgent_promptsAggregateType<T extends Agent_promptsAggregateArgs> = {
        [P in keyof T & keyof AggregateAgent_prompts]: P extends '_count' | 'count'
      ? T[P] extends true
        ? number
        : GetScalarType<T[P], AggregateAgent_prompts[P]>
      : GetScalarType<T[P], AggregateAgent_prompts[P]>
  }




  export type agent_promptsGroupByArgs<ExtArgs extends $Extensions.InternalArgs = $Extensions.DefaultArgs> = {
    where?: agent_promptsWhereInput
    orderBy?: agent_promptsOrderByWithAggregationInput | agent_promptsOrderByWithAggregationInput[]
    by: Agent_promptsScalarFieldEnum[] | Agent_promptsScalarFieldEnum
    having?: agent_promptsScalarWhereWithAggregatesInput
    take?: number
    skip?: number
    _count?: Agent_promptsCountAggregateInputType | true
    _avg?: Agent_promptsAvgAggregateInputType
    _sum?: Agent_promptsSumAggregateInputType
    _min?: Agent_promptsMinAggregateInputType
    _max?: Agent_promptsMaxAggregateInputType
  }

  export type Agent_promptsGroupByOutputType = {
    id: string
    agentId: string
    version: number
    name: string
    description: string | null
    systemPrompt: string
    compiledSystemPrompt: string | null
    compileStatus: string | null
    compileError: string | null
    sourceHash: string | null
    compileContextHash: string | null
    compiledAt: Date | null
    temperature: number | null
    maxTokens: number | null
    model: string | null
    status: string
    createdBy: string
    createdAt: Date
    updatedAt: Date
    metadata: string | null
    useCount: number
    avgLatency: number | null
    successRate: number | null
    publishedAt: Date | null
    _count: Agent_promptsCountAggregateOutputType | null
    _avg: Agent_promptsAvgAggregateOutputType | null
    _sum: Agent_promptsSumAggregateOutputType | null
    _min: Agent_promptsMinAggregateOutputType | null
    _max: Agent_promptsMaxAggregateOutputType | null
  }

  type GetAgent_promptsGroupByPayload<T extends agent_promptsGroupByArgs> = Prisma.PrismaPromise<
    Array<
      PickEnumerable<Agent_promptsGroupByOutputType, T['by']> &
        {
          [P in ((keyof T) & (keyof Agent_promptsGroupByOutputType))]: P extends '_count'
            ? T[P] extends boolean
              ? number
              : GetScalarType<T[P], Agent_promptsGroupByOutputType[P]>
            : GetScalarType<T[P], Agent_promptsGroupByOutputType[P]>
        }
      >
    >


  export type agent_promptsSelect<ExtArgs extends $Extensions.InternalArgs = $Extensions.DefaultArgs> = $Extensions.GetSelect<{
    id?: boolean
    agentId?: boolean
    version?: boolean
    name?: boolean
    description?: boolean
    systemPrompt?: boolean
    compiledSystemPrompt?: boolean
    compileStatus?: boolean
    compileError?: boolean
    sourceHash?: boolean
    compileContextHash?: boolean
    compiledAt?: boolean
    temperature?: boolean
    maxTokens?: boolean
    model?: boolean
    status?: boolean
    createdBy?: boolean
    createdAt?: boolean
    updatedAt?: boolean
    metadata?: boolean
    useCount?: boolean
    avgLatency?: boolean
    successRate?: boolean
    publishedAt?: boolean
  }, ExtArgs["result"]["agent_prompts"]>

  export type agent_promptsSelectCreateManyAndReturn<ExtArgs extends $Extensions.InternalArgs = $Extensions.DefaultArgs> = $Extensions.GetSelect<{
    id?: boolean
    agentId?: boolean
    version?: boolean
    name?: boolean
    description?: boolean
    systemPrompt?: boolean
    compiledSystemPrompt?: boolean
    compileStatus?: boolean
    compileError?: boolean
    sourceHash?: boolean
    compileContextHash?: boolean
    compiledAt?: boolean
    temperature?: boolean
    maxTokens?: boolean
    model?: boolean
    status?: boolean
    createdBy?: boolean
    createdAt?: boolean
    updatedAt?: boolean
    metadata?: boolean
    useCount?: boolean
    avgLatency?: boolean
    successRate?: boolean
    publishedAt?: boolean
  }, ExtArgs["result"]["agent_prompts"]>

  export type agent_promptsSelectScalar = {
    id?: boolean
    agentId?: boolean
    version?: boolean
    name?: boolean
    description?: boolean
    systemPrompt?: boolean
    compiledSystemPrompt?: boolean
    compileStatus?: boolean
    compileError?: boolean
    sourceHash?: boolean
    compileContextHash?: boolean
    compiledAt?: boolean
    temperature?: boolean
    maxTokens?: boolean
    model?: boolean
    status?: boolean
    createdBy?: boolean
    createdAt?: boolean
    updatedAt?: boolean
    metadata?: boolean
    useCount?: boolean
    avgLatency?: boolean
    successRate?: boolean
    publishedAt?: boolean
  }


  export type $agent_promptsPayload<ExtArgs extends $Extensions.InternalArgs = $Extensions.DefaultArgs> = {
    name: "agent_prompts"
    objects: {}
    scalars: $Extensions.GetPayloadResult<{
      id: string
      agentId: string
      version: number
      name: string
      description: string | null
      systemPrompt: string
      compiledSystemPrompt: string | null
      compileStatus: string | null
      compileError: string | null
      sourceHash: string | null
      compileContextHash: string | null
      compiledAt: Date | null
      temperature: number | null
      maxTokens: number | null
      model: string | null
      status: string
      createdBy: string
      createdAt: Date
      updatedAt: Date
      metadata: string | null
      useCount: number
      avgLatency: number | null
      successRate: number | null
      publishedAt: Date | null
    }, ExtArgs["result"]["agent_prompts"]>
    composites: {}
  }

  type agent_promptsGetPayload<S extends boolean | null | undefined | agent_promptsDefaultArgs> = $Result.GetResult<Prisma.$agent_promptsPayload, S>

  type agent_promptsCountArgs<ExtArgs extends $Extensions.InternalArgs = $Extensions.DefaultArgs> = 
    Omit<agent_promptsFindManyArgs, 'select' | 'include' | 'distinct'> & {
      select?: Agent_promptsCountAggregateInputType | true
    }

  export interface agent_promptsDelegate<ExtArgs extends $Extensions.InternalArgs = $Extensions.DefaultArgs> {
    [K: symbol]: { types: Prisma.TypeMap<ExtArgs>['model']['agent_prompts'], meta: { name: 'agent_prompts' } }
    /**
     * Find zero or one Agent_prompts that matches the filter.
     * @param {agent_promptsFindUniqueArgs} args - Arguments to find a Agent_prompts
     * @example
     * // Get one Agent_prompts
     * const agent_prompts = await prisma.agent_prompts.findUnique({
     *   where: {
     *     // ... provide filter here
     *   }
     * })
     */
    findUnique<T extends agent_promptsFindUniqueArgs>(args: SelectSubset<T, agent_promptsFindUniqueArgs<ExtArgs>>): Prisma__agent_promptsClient<$Result.GetResult<Prisma.$agent_promptsPayload<ExtArgs>, T, "findUnique"> | null, null, ExtArgs>

    /**
     * Find one Agent_prompts that matches the filter or throw an error with `error.code='P2025'` 
     * if no matches were found.
     * @param {agent_promptsFindUniqueOrThrowArgs} args - Arguments to find a Agent_prompts
     * @example
     * // Get one Agent_prompts
     * const agent_prompts = await prisma.agent_prompts.findUniqueOrThrow({
     *   where: {
     *     // ... provide filter here
     *   }
     * })
     */
    findUniqueOrThrow<T extends agent_promptsFindUniqueOrThrowArgs>(args: SelectSubset<T, agent_promptsFindUniqueOrThrowArgs<ExtArgs>>): Prisma__agent_promptsClient<$Result.GetResult<Prisma.$agent_promptsPayload<ExtArgs>, T, "findUniqueOrThrow">, never, ExtArgs>

    /**
     * Find the first Agent_prompts that matches the filter.
     * Note, that providing `undefined` is treated as the value not being there.
     * Read more here: https://pris.ly/d/null-undefined
     * @param {agent_promptsFindFirstArgs} args - Arguments to find a Agent_prompts
     * @example
     * // Get one Agent_prompts
     * const agent_prompts = await prisma.agent_prompts.findFirst({
     *   where: {
     *     // ... provide filter here
     *   }
     * })
     */
    findFirst<T extends agent_promptsFindFirstArgs>(args?: SelectSubset<T, agent_promptsFindFirstArgs<ExtArgs>>): Prisma__agent_promptsClient<$Result.GetResult<Prisma.$agent_promptsPayload<ExtArgs>, T, "findFirst"> | null, null, ExtArgs>

    /**
     * Find the first Agent_prompts that matches the filter or
     * throw `PrismaKnownClientError` with `P2025` code if no matches were found.
     * Note, that providing `undefined` is treated as the value not being there.
     * Read more here: https://pris.ly/d/null-undefined
     * @param {agent_promptsFindFirstOrThrowArgs} args - Arguments to find a Agent_prompts
     * @example
     * // Get one Agent_prompts
     * const agent_prompts = await prisma.agent_prompts.findFirstOrThrow({
     *   where: {
     *     // ... provide filter here
     *   }
     * })
     */
    findFirstOrThrow<T extends agent_promptsFindFirstOrThrowArgs>(args?: SelectSubset<T, agent_promptsFindFirstOrThrowArgs<ExtArgs>>): Prisma__agent_promptsClient<$Result.GetResult<Prisma.$agent_promptsPayload<ExtArgs>, T, "findFirstOrThrow">, never, ExtArgs>

    /**
     * Find zero or more Agent_prompts that matches the filter.
     * Note, that providing `undefined` is treated as the value not being there.
     * Read more here: https://pris.ly/d/null-undefined
     * @param {agent_promptsFindManyArgs} args - Arguments to filter and select certain fields only.
     * @example
     * // Get all Agent_prompts
     * const agent_prompts = await prisma.agent_prompts.findMany()
     * 
     * // Get first 10 Agent_prompts
     * const agent_prompts = await prisma.agent_prompts.findMany({ take: 10 })
     * 
     * // Only select the `id`
     * const agent_promptsWithIdOnly = await prisma.agent_prompts.findMany({ select: { id: true } })
     * 
     */
    findMany<T extends agent_promptsFindManyArgs>(args?: SelectSubset<T, agent_promptsFindManyArgs<ExtArgs>>): Prisma.PrismaPromise<$Result.GetResult<Prisma.$agent_promptsPayload<ExtArgs>, T, "findMany">>

    /**
     * Create a Agent_prompts.
     * @param {agent_promptsCreateArgs} args - Arguments to create a Agent_prompts.
     * @example
     * // Create one Agent_prompts
     * const Agent_prompts = await prisma.agent_prompts.create({
     *   data: {
     *     // ... data to create a Agent_prompts
     *   }
     * })
     * 
     */
    create<T extends agent_promptsCreateArgs>(args: SelectSubset<T, agent_promptsCreateArgs<ExtArgs>>): Prisma__agent_promptsClient<$Result.GetResult<Prisma.$agent_promptsPayload<ExtArgs>, T, "create">, never, ExtArgs>

    /**
     * Create many Agent_prompts.
     * @param {agent_promptsCreateManyArgs} args - Arguments to create many Agent_prompts.
     * @example
     * // Create many Agent_prompts
     * const agent_prompts = await prisma.agent_prompts.createMany({
     *   data: [
     *     // ... provide data here
     *   ]
     * })
     *     
     */
    createMany<T extends agent_promptsCreateManyArgs>(args?: SelectSubset<T, agent_promptsCreateManyArgs<ExtArgs>>): Prisma.PrismaPromise<BatchPayload>

    /**
     * Create many Agent_prompts and returns the data saved in the database.
     * @param {agent_promptsCreateManyAndReturnArgs} args - Arguments to create many Agent_prompts.
     * @example
     * // Create many Agent_prompts
     * const agent_prompts = await prisma.agent_prompts.createManyAndReturn({
     *   data: [
     *     // ... provide data here
     *   ]
     * })
     * 
     * // Create many Agent_prompts and only return the `id`
     * const agent_promptsWithIdOnly = await prisma.agent_prompts.createManyAndReturn({ 
     *   select: { id: true },
     *   data: [
     *     // ... provide data here
     *   ]
     * })
     * Note, that providing `undefined` is treated as the value not being there.
     * Read more here: https://pris.ly/d/null-undefined
     * 
     */
    createManyAndReturn<T extends agent_promptsCreateManyAndReturnArgs>(args?: SelectSubset<T, agent_promptsCreateManyAndReturnArgs<ExtArgs>>): Prisma.PrismaPromise<$Result.GetResult<Prisma.$agent_promptsPayload<ExtArgs>, T, "createManyAndReturn">>

    /**
     * Delete a Agent_prompts.
     * @param {agent_promptsDeleteArgs} args - Arguments to delete one Agent_prompts.
     * @example
     * // Delete one Agent_prompts
     * const Agent_prompts = await prisma.agent_prompts.delete({
     *   where: {
     *     // ... filter to delete one Agent_prompts
     *   }
     * })
     * 
     */
    delete<T extends agent_promptsDeleteArgs>(args: SelectSubset<T, agent_promptsDeleteArgs<ExtArgs>>): Prisma__agent_promptsClient<$Result.GetResult<Prisma.$agent_promptsPayload<ExtArgs>, T, "delete">, never, ExtArgs>

    /**
     * Update one Agent_prompts.
     * @param {agent_promptsUpdateArgs} args - Arguments to update one Agent_prompts.
     * @example
     * // Update one Agent_prompts
     * const agent_prompts = await prisma.agent_prompts.update({
     *   where: {
     *     // ... provide filter here
     *   },
     *   data: {
     *     // ... provide data here
     *   }
     * })
     * 
     */
    update<T extends agent_promptsUpdateArgs>(args: SelectSubset<T, agent_promptsUpdateArgs<ExtArgs>>): Prisma__agent_promptsClient<$Result.GetResult<Prisma.$agent_promptsPayload<ExtArgs>, T, "update">, never, ExtArgs>

    /**
     * Delete zero or more Agent_prompts.
     * @param {agent_promptsDeleteManyArgs} args - Arguments to filter Agent_prompts to delete.
     * @example
     * // Delete a few Agent_prompts
     * const { count } = await prisma.agent_prompts.deleteMany({
     *   where: {
     *     // ... provide filter here
     *   }
     * })
     * 
     */
    deleteMany<T extends agent_promptsDeleteManyArgs>(args?: SelectSubset<T, agent_promptsDeleteManyArgs<ExtArgs>>): Prisma.PrismaPromise<BatchPayload>

    /**
     * Update zero or more Agent_prompts.
     * Note, that providing `undefined` is treated as the value not being there.
     * Read more here: https://pris.ly/d/null-undefined
     * @param {agent_promptsUpdateManyArgs} args - Arguments to update one or more rows.
     * @example
     * // Update many Agent_prompts
     * const agent_prompts = await prisma.agent_prompts.updateMany({
     *   where: {
     *     // ... provide filter here
     *   },
     *   data: {
     *     // ... provide data here
     *   }
     * })
     * 
     */
    updateMany<T extends agent_promptsUpdateManyArgs>(args: SelectSubset<T, agent_promptsUpdateManyArgs<ExtArgs>>): Prisma.PrismaPromise<BatchPayload>

    /**
     * Create or update one Agent_prompts.
     * @param {agent_promptsUpsertArgs} args - Arguments to update or create a Agent_prompts.
     * @example
     * // Update or create a Agent_prompts
     * const agent_prompts = await prisma.agent_prompts.upsert({
     *   create: {
     *     // ... data to create a Agent_prompts
     *   },
     *   update: {
     *     // ... in case it already exists, update
     *   },
     *   where: {
     *     // ... the filter for the Agent_prompts we want to update
     *   }
     * })
     */
    upsert<T extends agent_promptsUpsertArgs>(args: SelectSubset<T, agent_promptsUpsertArgs<ExtArgs>>): Prisma__agent_promptsClient<$Result.GetResult<Prisma.$agent_promptsPayload<ExtArgs>, T, "upsert">, never, ExtArgs>


    /**
     * Count the number of Agent_prompts.
     * Note, that providing `undefined` is treated as the value not being there.
     * Read more here: https://pris.ly/d/null-undefined
     * @param {agent_promptsCountArgs} args - Arguments to filter Agent_prompts to count.
     * @example
     * // Count the number of Agent_prompts
     * const count = await prisma.agent_prompts.count({
     *   where: {
     *     // ... the filter for the Agent_prompts we want to count
     *   }
     * })
    **/
    count<T extends agent_promptsCountArgs>(
      args?: Subset<T, agent_promptsCountArgs>,
    ): Prisma.PrismaPromise<
      T extends $Utils.Record<'select', any>
        ? T['select'] extends true
          ? number
          : GetScalarType<T['select'], Agent_promptsCountAggregateOutputType>
        : number
    >

    /**
     * Allows you to perform aggregations operations on a Agent_prompts.
     * Note, that providing `undefined` is treated as the value not being there.
     * Read more here: https://pris.ly/d/null-undefined
     * @param {Agent_promptsAggregateArgs} args - Select which aggregations you would like to apply and on what fields.
     * @example
     * // Ordered by age ascending
     * // Where email contains prisma.io
     * // Limited to the 10 users
     * const aggregations = await prisma.user.aggregate({
     *   _avg: {
     *     age: true,
     *   },
     *   where: {
     *     email: {
     *       contains: "prisma.io",
     *     },
     *   },
     *   orderBy: {
     *     age: "asc",
     *   },
     *   take: 10,
     * })
    **/
    aggregate<T extends Agent_promptsAggregateArgs>(args: Subset<T, Agent_promptsAggregateArgs>): Prisma.PrismaPromise<GetAgent_promptsAggregateType<T>>

    /**
     * Group by Agent_prompts.
     * Note, that providing `undefined` is treated as the value not being there.
     * Read more here: https://pris.ly/d/null-undefined
     * @param {agent_promptsGroupByArgs} args - Group by arguments.
     * @example
     * // Group by city, order by createdAt, get count
     * const result = await prisma.user.groupBy({
     *   by: ['city', 'createdAt'],
     *   orderBy: {
     *     createdAt: true
     *   },
     *   _count: {
     *     _all: true
     *   },
     * })
     * 
    **/
    groupBy<
      T extends agent_promptsGroupByArgs,
      HasSelectOrTake extends Or<
        Extends<'skip', Keys<T>>,
        Extends<'take', Keys<T>>
      >,
      OrderByArg extends True extends HasSelectOrTake
        ? { orderBy: agent_promptsGroupByArgs['orderBy'] }
        : { orderBy?: agent_promptsGroupByArgs['orderBy'] },
      OrderFields extends ExcludeUnderscoreKeys<Keys<MaybeTupleToUnion<T['orderBy']>>>,
      ByFields extends MaybeTupleToUnion<T['by']>,
      ByValid extends Has<ByFields, OrderFields>,
      HavingFields extends GetHavingFields<T['having']>,
      HavingValid extends Has<ByFields, HavingFields>,
      ByEmpty extends T['by'] extends never[] ? True : False,
      InputErrors extends ByEmpty extends True
      ? `Error: "by" must not be empty.`
      : HavingValid extends False
      ? {
          [P in HavingFields]: P extends ByFields
            ? never
            : P extends string
            ? `Error: Field "${P}" used in "having" needs to be provided in "by".`
            : [
                Error,
                'Field ',
                P,
                ` in "having" needs to be provided in "by"`,
              ]
        }[HavingFields]
      : 'take' extends Keys<T>
      ? 'orderBy' extends Keys<T>
        ? ByValid extends True
          ? {}
          : {
              [P in OrderFields]: P extends ByFields
                ? never
                : `Error: Field "${P}" in "orderBy" needs to be provided in "by"`
            }[OrderFields]
        : 'Error: If you provide "take", you also need to provide "orderBy"'
      : 'skip' extends Keys<T>
      ? 'orderBy' extends Keys<T>
        ? ByValid extends True
          ? {}
          : {
              [P in OrderFields]: P extends ByFields
                ? never
                : `Error: Field "${P}" in "orderBy" needs to be provided in "by"`
            }[OrderFields]
        : 'Error: If you provide "skip", you also need to provide "orderBy"'
      : ByValid extends True
      ? {}
      : {
          [P in OrderFields]: P extends ByFields
            ? never
            : `Error: Field "${P}" in "orderBy" needs to be provided in "by"`
        }[OrderFields]
    >(args: SubsetIntersection<T, agent_promptsGroupByArgs, OrderByArg> & InputErrors): {} extends InputErrors ? GetAgent_promptsGroupByPayload<T> : Prisma.PrismaPromise<InputErrors>
  /**
   * Fields of the agent_prompts model
   */
  readonly fields: agent_promptsFieldRefs;
  }

  /**
   * The delegate class that acts as a "Promise-like" for agent_prompts.
   * Why is this prefixed with `Prisma__`?
   * Because we want to prevent naming conflicts as mentioned in
   * https://github.com/prisma/prisma-client-js/issues/707
   */
  export interface Prisma__agent_promptsClient<T, Null = never, ExtArgs extends $Extensions.InternalArgs = $Extensions.DefaultArgs> extends Prisma.PrismaPromise<T> {
    readonly [Symbol.toStringTag]: "PrismaPromise"
    /**
     * Attaches callbacks for the resolution and/or rejection of the Promise.
     * @param onfulfilled The callback to execute when the Promise is resolved.
     * @param onrejected The callback to execute when the Promise is rejected.
     * @returns A Promise for the completion of which ever callback is executed.
     */
    then<TResult1 = T, TResult2 = never>(onfulfilled?: ((value: T) => TResult1 | PromiseLike<TResult1>) | undefined | null, onrejected?: ((reason: any) => TResult2 | PromiseLike<TResult2>) | undefined | null): $Utils.JsPromise<TResult1 | TResult2>
    /**
     * Attaches a callback for only the rejection of the Promise.
     * @param onrejected The callback to execute when the Promise is rejected.
     * @returns A Promise for the completion of the callback.
     */
    catch<TResult = never>(onrejected?: ((reason: any) => TResult | PromiseLike<TResult>) | undefined | null): $Utils.JsPromise<T | TResult>
    /**
     * Attaches a callback that is invoked when the Promise is settled (fulfilled or rejected). The
     * resolved value cannot be modified from the callback.
     * @param onfinally The callback to execute when the Promise is settled (fulfilled or rejected).
     * @returns A Promise for the completion of the callback.
     */
    finally(onfinally?: (() => void) | undefined | null): $Utils.JsPromise<T>
  }




  /**
   * Fields of the agent_prompts model
   */ 
  interface agent_promptsFieldRefs {
    readonly id: FieldRef<"agent_prompts", 'String'>
    readonly agentId: FieldRef<"agent_prompts", 'String'>
    readonly version: FieldRef<"agent_prompts", 'Int'>
    readonly name: FieldRef<"agent_prompts", 'String'>
    readonly description: FieldRef<"agent_prompts", 'String'>
    readonly systemPrompt: FieldRef<"agent_prompts", 'String'>
    readonly compiledSystemPrompt: FieldRef<"agent_prompts", 'String'>
    readonly compileStatus: FieldRef<"agent_prompts", 'String'>
    readonly compileError: FieldRef<"agent_prompts", 'String'>
    readonly sourceHash: FieldRef<"agent_prompts", 'String'>
    readonly compileContextHash: FieldRef<"agent_prompts", 'String'>
    readonly compiledAt: FieldRef<"agent_prompts", 'DateTime'>
    readonly temperature: FieldRef<"agent_prompts", 'Float'>
    readonly maxTokens: FieldRef<"agent_prompts", 'Int'>
    readonly model: FieldRef<"agent_prompts", 'String'>
    readonly status: FieldRef<"agent_prompts", 'String'>
    readonly createdBy: FieldRef<"agent_prompts", 'String'>
    readonly createdAt: FieldRef<"agent_prompts", 'DateTime'>
    readonly updatedAt: FieldRef<"agent_prompts", 'DateTime'>
    readonly metadata: FieldRef<"agent_prompts", 'String'>
    readonly useCount: FieldRef<"agent_prompts", 'Int'>
    readonly avgLatency: FieldRef<"agent_prompts", 'Float'>
    readonly successRate: FieldRef<"agent_prompts", 'Float'>
    readonly publishedAt: FieldRef<"agent_prompts", 'DateTime'>
  }
    

  // Custom InputTypes
  /**
   * agent_prompts findUnique
   */
  export type agent_promptsFindUniqueArgs<ExtArgs extends $Extensions.InternalArgs = $Extensions.DefaultArgs> = {
    /**
     * Select specific fields to fetch from the agent_prompts
     */
    select?: agent_promptsSelect<ExtArgs> | null
    /**
     * Filter, which agent_prompts to fetch.
     */
    where: agent_promptsWhereUniqueInput
  }

  /**
   * agent_prompts findUniqueOrThrow
   */
  export type agent_promptsFindUniqueOrThrowArgs<ExtArgs extends $Extensions.InternalArgs = $Extensions.DefaultArgs> = {
    /**
     * Select specific fields to fetch from the agent_prompts
     */
    select?: agent_promptsSelect<ExtArgs> | null
    /**
     * Filter, which agent_prompts to fetch.
     */
    where: agent_promptsWhereUniqueInput
  }

  /**
   * agent_prompts findFirst
   */
  export type agent_promptsFindFirstArgs<ExtArgs extends $Extensions.InternalArgs = $Extensions.DefaultArgs> = {
    /**
     * Select specific fields to fetch from the agent_prompts
     */
    select?: agent_promptsSelect<ExtArgs> | null
    /**
     * Filter, which agent_prompts to fetch.
     */
    where?: agent_promptsWhereInput
    /**
     * {@link https://www.prisma.io/docs/concepts/components/prisma-client/sorting Sorting Docs}
     * 
     * Determine the order of agent_prompts to fetch.
     */
    orderBy?: agent_promptsOrderByWithRelationInput | agent_promptsOrderByWithRelationInput[]
    /**
     * {@link https://www.prisma.io/docs/concepts/components/prisma-client/pagination#cursor-based-pagination Cursor Docs}
     * 
     * Sets the position for searching for agent_prompts.
     */
    cursor?: agent_promptsWhereUniqueInput
    /**
     * {@link https://www.prisma.io/docs/concepts/components/prisma-client/pagination Pagination Docs}
     * 
     * Take `±n` agent_prompts from the position of the cursor.
     */
    take?: number
    /**
     * {@link https://www.prisma.io/docs/concepts/components/prisma-client/pagination Pagination Docs}
     * 
     * Skip the first `n` agent_prompts.
     */
    skip?: number
    /**
     * {@link https://www.prisma.io/docs/concepts/components/prisma-client/distinct Distinct Docs}
     * 
     * Filter by unique combinations of agent_prompts.
     */
    distinct?: Agent_promptsScalarFieldEnum | Agent_promptsScalarFieldEnum[]
  }

  /**
   * agent_prompts findFirstOrThrow
   */
  export type agent_promptsFindFirstOrThrowArgs<ExtArgs extends $Extensions.InternalArgs = $Extensions.DefaultArgs> = {
    /**
     * Select specific fields to fetch from the agent_prompts
     */
    select?: agent_promptsSelect<ExtArgs> | null
    /**
     * Filter, which agent_prompts to fetch.
     */
    where?: agent_promptsWhereInput
    /**
     * {@link https://www.prisma.io/docs/concepts/components/prisma-client/sorting Sorting Docs}
     * 
     * Determine the order of agent_prompts to fetch.
     */
    orderBy?: agent_promptsOrderByWithRelationInput | agent_promptsOrderByWithRelationInput[]
    /**
     * {@link https://www.prisma.io/docs/concepts/components/prisma-client/pagination#cursor-based-pagination Cursor Docs}
     * 
     * Sets the position for searching for agent_prompts.
     */
    cursor?: agent_promptsWhereUniqueInput
    /**
     * {@link https://www.prisma.io/docs/concepts/components/prisma-client/pagination Pagination Docs}
     * 
     * Take `±n` agent_prompts from the position of the cursor.
     */
    take?: number
    /**
     * {@link https://www.prisma.io/docs/concepts/components/prisma-client/pagination Pagination Docs}
     * 
     * Skip the first `n` agent_prompts.
     */
    skip?: number
    /**
     * {@link https://www.prisma.io/docs/concepts/components/prisma-client/distinct Distinct Docs}
     * 
     * Filter by unique combinations of agent_prompts.
     */
    distinct?: Agent_promptsScalarFieldEnum | Agent_promptsScalarFieldEnum[]
  }

  /**
   * agent_prompts findMany
   */
  export type agent_promptsFindManyArgs<ExtArgs extends $Extensions.InternalArgs = $Extensions.DefaultArgs> = {
    /**
     * Select specific fields to fetch from the agent_prompts
     */
    select?: agent_promptsSelect<ExtArgs> | null
    /**
     * Filter, which agent_prompts to fetch.
     */
    where?: agent_promptsWhereInput
    /**
     * {@link https://www.prisma.io/docs/concepts/components/prisma-client/sorting Sorting Docs}
     * 
     * Determine the order of agent_prompts to fetch.
     */
    orderBy?: agent_promptsOrderByWithRelationInput | agent_promptsOrderByWithRelationInput[]
    /**
     * {@link https://www.prisma.io/docs/concepts/components/prisma-client/pagination#cursor-based-pagination Cursor Docs}
     * 
     * Sets the position for listing agent_prompts.
     */
    cursor?: agent_promptsWhereUniqueInput
    /**
     * {@link https://www.prisma.io/docs/concepts/components/prisma-client/pagination Pagination Docs}
     * 
     * Take `±n` agent_prompts from the position of the cursor.
     */
    take?: number
    /**
     * {@link https://www.prisma.io/docs/concepts/components/prisma-client/pagination Pagination Docs}
     * 
     * Skip the first `n` agent_prompts.
     */
    skip?: number
    distinct?: Agent_promptsScalarFieldEnum | Agent_promptsScalarFieldEnum[]
  }

  /**
   * agent_prompts create
   */
  export type agent_promptsCreateArgs<ExtArgs extends $Extensions.InternalArgs = $Extensions.DefaultArgs> = {
    /**
     * Select specific fields to fetch from the agent_prompts
     */
    select?: agent_promptsSelect<ExtArgs> | null
    /**
     * The data needed to create a agent_prompts.
     */
    data: XOR<agent_promptsCreateInput, agent_promptsUncheckedCreateInput>
  }

  /**
   * agent_prompts createMany
   */
  export type agent_promptsCreateManyArgs<ExtArgs extends $Extensions.InternalArgs = $Extensions.DefaultArgs> = {
    /**
     * The data used to create many agent_prompts.
     */
    data: agent_promptsCreateManyInput | agent_promptsCreateManyInput[]
  }

  /**
   * agent_prompts createManyAndReturn
   */
  export type agent_promptsCreateManyAndReturnArgs<ExtArgs extends $Extensions.InternalArgs = $Extensions.DefaultArgs> = {
    /**
     * Select specific fields to fetch from the agent_prompts
     */
    select?: agent_promptsSelectCreateManyAndReturn<ExtArgs> | null
    /**
     * The data used to create many agent_prompts.
     */
    data: agent_promptsCreateManyInput | agent_promptsCreateManyInput[]
  }

  /**
   * agent_prompts update
   */
  export type agent_promptsUpdateArgs<ExtArgs extends $Extensions.InternalArgs = $Extensions.DefaultArgs> = {
    /**
     * Select specific fields to fetch from the agent_prompts
     */
    select?: agent_promptsSelect<ExtArgs> | null
    /**
     * The data needed to update a agent_prompts.
     */
    data: XOR<agent_promptsUpdateInput, agent_promptsUncheckedUpdateInput>
    /**
     * Choose, which agent_prompts to update.
     */
    where: agent_promptsWhereUniqueInput
  }

  /**
   * agent_prompts updateMany
   */
  export type agent_promptsUpdateManyArgs<ExtArgs extends $Extensions.InternalArgs = $Extensions.DefaultArgs> = {
    /**
     * The data used to update agent_prompts.
     */
    data: XOR<agent_promptsUpdateManyMutationInput, agent_promptsUncheckedUpdateManyInput>
    /**
     * Filter which agent_prompts to update
     */
    where?: agent_promptsWhereInput
  }

  /**
   * agent_prompts upsert
   */
  export type agent_promptsUpsertArgs<ExtArgs extends $Extensions.InternalArgs = $Extensions.DefaultArgs> = {
    /**
     * Select specific fields to fetch from the agent_prompts
     */
    select?: agent_promptsSelect<ExtArgs> | null
    /**
     * The filter to search for the agent_prompts to update in case it exists.
     */
    where: agent_promptsWhereUniqueInput
    /**
     * In case the agent_prompts found by the `where` argument doesn't exist, create a new agent_prompts with this data.
     */
    create: XOR<agent_promptsCreateInput, agent_promptsUncheckedCreateInput>
    /**
     * In case the agent_prompts was found with the provided `where` argument, update it with this data.
     */
    update: XOR<agent_promptsUpdateInput, agent_promptsUncheckedUpdateInput>
  }

  /**
   * agent_prompts delete
   */
  export type agent_promptsDeleteArgs<ExtArgs extends $Extensions.InternalArgs = $Extensions.DefaultArgs> = {
    /**
     * Select specific fields to fetch from the agent_prompts
     */
    select?: agent_promptsSelect<ExtArgs> | null
    /**
     * Filter which agent_prompts to delete.
     */
    where: agent_promptsWhereUniqueInput
  }

  /**
   * agent_prompts deleteMany
   */
  export type agent_promptsDeleteManyArgs<ExtArgs extends $Extensions.InternalArgs = $Extensions.DefaultArgs> = {
    /**
     * Filter which agent_prompts to delete
     */
    where?: agent_promptsWhereInput
  }

  /**
   * agent_prompts without action
   */
  export type agent_promptsDefaultArgs<ExtArgs extends $Extensions.InternalArgs = $Extensions.DefaultArgs> = {
    /**
     * Select specific fields to fetch from the agent_prompts
     */
    select?: agent_promptsSelect<ExtArgs> | null
  }


  /**
   * Model agent_definitions
   */

  export type AggregateAgent_definitions = {
    _count: Agent_definitionsCountAggregateOutputType | null
    _avg: Agent_definitionsAvgAggregateOutputType | null
    _sum: Agent_definitionsSumAggregateOutputType | null
    _min: Agent_definitionsMinAggregateOutputType | null
    _max: Agent_definitionsMaxAggregateOutputType | null
  }

  export type Agent_definitionsAvgAggregateOutputType = {
    defaultMaxTokens: number | null
    defaultTemperature: number | null
    schemaVersion: number | null
  }

  export type Agent_definitionsSumAggregateOutputType = {
    defaultMaxTokens: number | null
    defaultTemperature: number | null
    schemaVersion: number | null
  }

  export type Agent_definitionsMinAggregateOutputType = {
    id: string | null
    displayName: string | null
    description: string | null
    category: string | null
    inputSchema: string | null
    outputSchema: string | null
    variableBindings: string | null
    capabilities: string | null
    defaultMaxTokens: number | null
    defaultTemperature: number | null
    schemaVersion: number | null
    source: string | null
    managedByCode: boolean | null
    createdAt: Date | null
    updatedAt: Date | null
  }

  export type Agent_definitionsMaxAggregateOutputType = {
    id: string | null
    displayName: string | null
    description: string | null
    category: string | null
    inputSchema: string | null
    outputSchema: string | null
    variableBindings: string | null
    capabilities: string | null
    defaultMaxTokens: number | null
    defaultTemperature: number | null
    schemaVersion: number | null
    source: string | null
    managedByCode: boolean | null
    createdAt: Date | null
    updatedAt: Date | null
  }

  export type Agent_definitionsCountAggregateOutputType = {
    id: number
    displayName: number
    description: number
    category: number
    inputSchema: number
    outputSchema: number
    variableBindings: number
    capabilities: number
    defaultMaxTokens: number
    defaultTemperature: number
    schemaVersion: number
    source: number
    managedByCode: number
    createdAt: number
    updatedAt: number
    _all: number
  }


  export type Agent_definitionsAvgAggregateInputType = {
    defaultMaxTokens?: true
    defaultTemperature?: true
    schemaVersion?: true
  }

  export type Agent_definitionsSumAggregateInputType = {
    defaultMaxTokens?: true
    defaultTemperature?: true
    schemaVersion?: true
  }

  export type Agent_definitionsMinAggregateInputType = {
    id?: true
    displayName?: true
    description?: true
    category?: true
    inputSchema?: true
    outputSchema?: true
    variableBindings?: true
    capabilities?: true
    defaultMaxTokens?: true
    defaultTemperature?: true
    schemaVersion?: true
    source?: true
    managedByCode?: true
    createdAt?: true
    updatedAt?: true
  }

  export type Agent_definitionsMaxAggregateInputType = {
    id?: true
    displayName?: true
    description?: true
    category?: true
    inputSchema?: true
    outputSchema?: true
    variableBindings?: true
    capabilities?: true
    defaultMaxTokens?: true
    defaultTemperature?: true
    schemaVersion?: true
    source?: true
    managedByCode?: true
    createdAt?: true
    updatedAt?: true
  }

  export type Agent_definitionsCountAggregateInputType = {
    id?: true
    displayName?: true
    description?: true
    category?: true
    inputSchema?: true
    outputSchema?: true
    variableBindings?: true
    capabilities?: true
    defaultMaxTokens?: true
    defaultTemperature?: true
    schemaVersion?: true
    source?: true
    managedByCode?: true
    createdAt?: true
    updatedAt?: true
    _all?: true
  }

  export type Agent_definitionsAggregateArgs<ExtArgs extends $Extensions.InternalArgs = $Extensions.DefaultArgs> = {
    /**
     * Filter which agent_definitions to aggregate.
     */
    where?: agent_definitionsWhereInput
    /**
     * {@link https://www.prisma.io/docs/concepts/components/prisma-client/sorting Sorting Docs}
     * 
     * Determine the order of agent_definitions to fetch.
     */
    orderBy?: agent_definitionsOrderByWithRelationInput | agent_definitionsOrderByWithRelationInput[]
    /**
     * {@link https://www.prisma.io/docs/concepts/components/prisma-client/pagination#cursor-based-pagination Cursor Docs}
     * 
     * Sets the start position
     */
    cursor?: agent_definitionsWhereUniqueInput
    /**
     * {@link https://www.prisma.io/docs/concepts/components/prisma-client/pagination Pagination Docs}
     * 
     * Take `±n` agent_definitions from the position of the cursor.
     */
    take?: number
    /**
     * {@link https://www.prisma.io/docs/concepts/components/prisma-client/pagination Pagination Docs}
     * 
     * Skip the first `n` agent_definitions.
     */
    skip?: number
    /**
     * {@link https://www.prisma.io/docs/concepts/components/prisma-client/aggregations Aggregation Docs}
     * 
     * Count returned agent_definitions
    **/
    _count?: true | Agent_definitionsCountAggregateInputType
    /**
     * {@link https://www.prisma.io/docs/concepts/components/prisma-client/aggregations Aggregation Docs}
     * 
     * Select which fields to average
    **/
    _avg?: Agent_definitionsAvgAggregateInputType
    /**
     * {@link https://www.prisma.io/docs/concepts/components/prisma-client/aggregations Aggregation Docs}
     * 
     * Select which fields to sum
    **/
    _sum?: Agent_definitionsSumAggregateInputType
    /**
     * {@link https://www.prisma.io/docs/concepts/components/prisma-client/aggregations Aggregation Docs}
     * 
     * Select which fields to find the minimum value
    **/
    _min?: Agent_definitionsMinAggregateInputType
    /**
     * {@link https://www.prisma.io/docs/concepts/components/prisma-client/aggregations Aggregation Docs}
     * 
     * Select which fields to find the maximum value
    **/
    _max?: Agent_definitionsMaxAggregateInputType
  }

  export type GetAgent_definitionsAggregateType<T extends Agent_definitionsAggregateArgs> = {
        [P in keyof T & keyof AggregateAgent_definitions]: P extends '_count' | 'count'
      ? T[P] extends true
        ? number
        : GetScalarType<T[P], AggregateAgent_definitions[P]>
      : GetScalarType<T[P], AggregateAgent_definitions[P]>
  }




  export type agent_definitionsGroupByArgs<ExtArgs extends $Extensions.InternalArgs = $Extensions.DefaultArgs> = {
    where?: agent_definitionsWhereInput
    orderBy?: agent_definitionsOrderByWithAggregationInput | agent_definitionsOrderByWithAggregationInput[]
    by: Agent_definitionsScalarFieldEnum[] | Agent_definitionsScalarFieldEnum
    having?: agent_definitionsScalarWhereWithAggregatesInput
    take?: number
    skip?: number
    _count?: Agent_definitionsCountAggregateInputType | true
    _avg?: Agent_definitionsAvgAggregateInputType
    _sum?: Agent_definitionsSumAggregateInputType
    _min?: Agent_definitionsMinAggregateInputType
    _max?: Agent_definitionsMaxAggregateInputType
  }

  export type Agent_definitionsGroupByOutputType = {
    id: string
    displayName: string
    description: string | null
    category: string
    inputSchema: string | null
    outputSchema: string | null
    variableBindings: string | null
    capabilities: string | null
    defaultMaxTokens: number | null
    defaultTemperature: number | null
    schemaVersion: number
    source: string
    managedByCode: boolean
    createdAt: Date
    updatedAt: Date
    _count: Agent_definitionsCountAggregateOutputType | null
    _avg: Agent_definitionsAvgAggregateOutputType | null
    _sum: Agent_definitionsSumAggregateOutputType | null
    _min: Agent_definitionsMinAggregateOutputType | null
    _max: Agent_definitionsMaxAggregateOutputType | null
  }

  type GetAgent_definitionsGroupByPayload<T extends agent_definitionsGroupByArgs> = Prisma.PrismaPromise<
    Array<
      PickEnumerable<Agent_definitionsGroupByOutputType, T['by']> &
        {
          [P in ((keyof T) & (keyof Agent_definitionsGroupByOutputType))]: P extends '_count'
            ? T[P] extends boolean
              ? number
              : GetScalarType<T[P], Agent_definitionsGroupByOutputType[P]>
            : GetScalarType<T[P], Agent_definitionsGroupByOutputType[P]>
        }
      >
    >


  export type agent_definitionsSelect<ExtArgs extends $Extensions.InternalArgs = $Extensions.DefaultArgs> = $Extensions.GetSelect<{
    id?: boolean
    displayName?: boolean
    description?: boolean
    category?: boolean
    inputSchema?: boolean
    outputSchema?: boolean
    variableBindings?: boolean
    capabilities?: boolean
    defaultMaxTokens?: boolean
    defaultTemperature?: boolean
    schemaVersion?: boolean
    source?: boolean
    managedByCode?: boolean
    createdAt?: boolean
    updatedAt?: boolean
  }, ExtArgs["result"]["agent_definitions"]>

  export type agent_definitionsSelectCreateManyAndReturn<ExtArgs extends $Extensions.InternalArgs = $Extensions.DefaultArgs> = $Extensions.GetSelect<{
    id?: boolean
    displayName?: boolean
    description?: boolean
    category?: boolean
    inputSchema?: boolean
    outputSchema?: boolean
    variableBindings?: boolean
    capabilities?: boolean
    defaultMaxTokens?: boolean
    defaultTemperature?: boolean
    schemaVersion?: boolean
    source?: boolean
    managedByCode?: boolean
    createdAt?: boolean
    updatedAt?: boolean
  }, ExtArgs["result"]["agent_definitions"]>

  export type agent_definitionsSelectScalar = {
    id?: boolean
    displayName?: boolean
    description?: boolean
    category?: boolean
    inputSchema?: boolean
    outputSchema?: boolean
    variableBindings?: boolean
    capabilities?: boolean
    defaultMaxTokens?: boolean
    defaultTemperature?: boolean
    schemaVersion?: boolean
    source?: boolean
    managedByCode?: boolean
    createdAt?: boolean
    updatedAt?: boolean
  }


  export type $agent_definitionsPayload<ExtArgs extends $Extensions.InternalArgs = $Extensions.DefaultArgs> = {
    name: "agent_definitions"
    objects: {}
    scalars: $Extensions.GetPayloadResult<{
      id: string
      displayName: string
      description: string | null
      category: string
      inputSchema: string | null
      outputSchema: string | null
      variableBindings: string | null
      capabilities: string | null
      defaultMaxTokens: number | null
      defaultTemperature: number | null
      schemaVersion: number
      source: string
      managedByCode: boolean
      createdAt: Date
      updatedAt: Date
    }, ExtArgs["result"]["agent_definitions"]>
    composites: {}
  }

  type agent_definitionsGetPayload<S extends boolean | null | undefined | agent_definitionsDefaultArgs> = $Result.GetResult<Prisma.$agent_definitionsPayload, S>

  type agent_definitionsCountArgs<ExtArgs extends $Extensions.InternalArgs = $Extensions.DefaultArgs> = 
    Omit<agent_definitionsFindManyArgs, 'select' | 'include' | 'distinct'> & {
      select?: Agent_definitionsCountAggregateInputType | true
    }

  export interface agent_definitionsDelegate<ExtArgs extends $Extensions.InternalArgs = $Extensions.DefaultArgs> {
    [K: symbol]: { types: Prisma.TypeMap<ExtArgs>['model']['agent_definitions'], meta: { name: 'agent_definitions' } }
    /**
     * Find zero or one Agent_definitions that matches the filter.
     * @param {agent_definitionsFindUniqueArgs} args - Arguments to find a Agent_definitions
     * @example
     * // Get one Agent_definitions
     * const agent_definitions = await prisma.agent_definitions.findUnique({
     *   where: {
     *     // ... provide filter here
     *   }
     * })
     */
    findUnique<T extends agent_definitionsFindUniqueArgs>(args: SelectSubset<T, agent_definitionsFindUniqueArgs<ExtArgs>>): Prisma__agent_definitionsClient<$Result.GetResult<Prisma.$agent_definitionsPayload<ExtArgs>, T, "findUnique"> | null, null, ExtArgs>

    /**
     * Find one Agent_definitions that matches the filter or throw an error with `error.code='P2025'` 
     * if no matches were found.
     * @param {agent_definitionsFindUniqueOrThrowArgs} args - Arguments to find a Agent_definitions
     * @example
     * // Get one Agent_definitions
     * const agent_definitions = await prisma.agent_definitions.findUniqueOrThrow({
     *   where: {
     *     // ... provide filter here
     *   }
     * })
     */
    findUniqueOrThrow<T extends agent_definitionsFindUniqueOrThrowArgs>(args: SelectSubset<T, agent_definitionsFindUniqueOrThrowArgs<ExtArgs>>): Prisma__agent_definitionsClient<$Result.GetResult<Prisma.$agent_definitionsPayload<ExtArgs>, T, "findUniqueOrThrow">, never, ExtArgs>

    /**
     * Find the first Agent_definitions that matches the filter.
     * Note, that providing `undefined` is treated as the value not being there.
     * Read more here: https://pris.ly/d/null-undefined
     * @param {agent_definitionsFindFirstArgs} args - Arguments to find a Agent_definitions
     * @example
     * // Get one Agent_definitions
     * const agent_definitions = await prisma.agent_definitions.findFirst({
     *   where: {
     *     // ... provide filter here
     *   }
     * })
     */
    findFirst<T extends agent_definitionsFindFirstArgs>(args?: SelectSubset<T, agent_definitionsFindFirstArgs<ExtArgs>>): Prisma__agent_definitionsClient<$Result.GetResult<Prisma.$agent_definitionsPayload<ExtArgs>, T, "findFirst"> | null, null, ExtArgs>

    /**
     * Find the first Agent_definitions that matches the filter or
     * throw `PrismaKnownClientError` with `P2025` code if no matches were found.
     * Note, that providing `undefined` is treated as the value not being there.
     * Read more here: https://pris.ly/d/null-undefined
     * @param {agent_definitionsFindFirstOrThrowArgs} args - Arguments to find a Agent_definitions
     * @example
     * // Get one Agent_definitions
     * const agent_definitions = await prisma.agent_definitions.findFirstOrThrow({
     *   where: {
     *     // ... provide filter here
     *   }
     * })
     */
    findFirstOrThrow<T extends agent_definitionsFindFirstOrThrowArgs>(args?: SelectSubset<T, agent_definitionsFindFirstOrThrowArgs<ExtArgs>>): Prisma__agent_definitionsClient<$Result.GetResult<Prisma.$agent_definitionsPayload<ExtArgs>, T, "findFirstOrThrow">, never, ExtArgs>

    /**
     * Find zero or more Agent_definitions that matches the filter.
     * Note, that providing `undefined` is treated as the value not being there.
     * Read more here: https://pris.ly/d/null-undefined
     * @param {agent_definitionsFindManyArgs} args - Arguments to filter and select certain fields only.
     * @example
     * // Get all Agent_definitions
     * const agent_definitions = await prisma.agent_definitions.findMany()
     * 
     * // Get first 10 Agent_definitions
     * const agent_definitions = await prisma.agent_definitions.findMany({ take: 10 })
     * 
     * // Only select the `id`
     * const agent_definitionsWithIdOnly = await prisma.agent_definitions.findMany({ select: { id: true } })
     * 
     */
    findMany<T extends agent_definitionsFindManyArgs>(args?: SelectSubset<T, agent_definitionsFindManyArgs<ExtArgs>>): Prisma.PrismaPromise<$Result.GetResult<Prisma.$agent_definitionsPayload<ExtArgs>, T, "findMany">>

    /**
     * Create a Agent_definitions.
     * @param {agent_definitionsCreateArgs} args - Arguments to create a Agent_definitions.
     * @example
     * // Create one Agent_definitions
     * const Agent_definitions = await prisma.agent_definitions.create({
     *   data: {
     *     // ... data to create a Agent_definitions
     *   }
     * })
     * 
     */
    create<T extends agent_definitionsCreateArgs>(args: SelectSubset<T, agent_definitionsCreateArgs<ExtArgs>>): Prisma__agent_definitionsClient<$Result.GetResult<Prisma.$agent_definitionsPayload<ExtArgs>, T, "create">, never, ExtArgs>

    /**
     * Create many Agent_definitions.
     * @param {agent_definitionsCreateManyArgs} args - Arguments to create many Agent_definitions.
     * @example
     * // Create many Agent_definitions
     * const agent_definitions = await prisma.agent_definitions.createMany({
     *   data: [
     *     // ... provide data here
     *   ]
     * })
     *     
     */
    createMany<T extends agent_definitionsCreateManyArgs>(args?: SelectSubset<T, agent_definitionsCreateManyArgs<ExtArgs>>): Prisma.PrismaPromise<BatchPayload>

    /**
     * Create many Agent_definitions and returns the data saved in the database.
     * @param {agent_definitionsCreateManyAndReturnArgs} args - Arguments to create many Agent_definitions.
     * @example
     * // Create many Agent_definitions
     * const agent_definitions = await prisma.agent_definitions.createManyAndReturn({
     *   data: [
     *     // ... provide data here
     *   ]
     * })
     * 
     * // Create many Agent_definitions and only return the `id`
     * const agent_definitionsWithIdOnly = await prisma.agent_definitions.createManyAndReturn({ 
     *   select: { id: true },
     *   data: [
     *     // ... provide data here
     *   ]
     * })
     * Note, that providing `undefined` is treated as the value not being there.
     * Read more here: https://pris.ly/d/null-undefined
     * 
     */
    createManyAndReturn<T extends agent_definitionsCreateManyAndReturnArgs>(args?: SelectSubset<T, agent_definitionsCreateManyAndReturnArgs<ExtArgs>>): Prisma.PrismaPromise<$Result.GetResult<Prisma.$agent_definitionsPayload<ExtArgs>, T, "createManyAndReturn">>

    /**
     * Delete a Agent_definitions.
     * @param {agent_definitionsDeleteArgs} args - Arguments to delete one Agent_definitions.
     * @example
     * // Delete one Agent_definitions
     * const Agent_definitions = await prisma.agent_definitions.delete({
     *   where: {
     *     // ... filter to delete one Agent_definitions
     *   }
     * })
     * 
     */
    delete<T extends agent_definitionsDeleteArgs>(args: SelectSubset<T, agent_definitionsDeleteArgs<ExtArgs>>): Prisma__agent_definitionsClient<$Result.GetResult<Prisma.$agent_definitionsPayload<ExtArgs>, T, "delete">, never, ExtArgs>

    /**
     * Update one Agent_definitions.
     * @param {agent_definitionsUpdateArgs} args - Arguments to update one Agent_definitions.
     * @example
     * // Update one Agent_definitions
     * const agent_definitions = await prisma.agent_definitions.update({
     *   where: {
     *     // ... provide filter here
     *   },
     *   data: {
     *     // ... provide data here
     *   }
     * })
     * 
     */
    update<T extends agent_definitionsUpdateArgs>(args: SelectSubset<T, agent_definitionsUpdateArgs<ExtArgs>>): Prisma__agent_definitionsClient<$Result.GetResult<Prisma.$agent_definitionsPayload<ExtArgs>, T, "update">, never, ExtArgs>

    /**
     * Delete zero or more Agent_definitions.
     * @param {agent_definitionsDeleteManyArgs} args - Arguments to filter Agent_definitions to delete.
     * @example
     * // Delete a few Agent_definitions
     * const { count } = await prisma.agent_definitions.deleteMany({
     *   where: {
     *     // ... provide filter here
     *   }
     * })
     * 
     */
    deleteMany<T extends agent_definitionsDeleteManyArgs>(args?: SelectSubset<T, agent_definitionsDeleteManyArgs<ExtArgs>>): Prisma.PrismaPromise<BatchPayload>

    /**
     * Update zero or more Agent_definitions.
     * Note, that providing `undefined` is treated as the value not being there.
     * Read more here: https://pris.ly/d/null-undefined
     * @param {agent_definitionsUpdateManyArgs} args - Arguments to update one or more rows.
     * @example
     * // Update many Agent_definitions
     * const agent_definitions = await prisma.agent_definitions.updateMany({
     *   where: {
     *     // ... provide filter here
     *   },
     *   data: {
     *     // ... provide data here
     *   }
     * })
     * 
     */
    updateMany<T extends agent_definitionsUpdateManyArgs>(args: SelectSubset<T, agent_definitionsUpdateManyArgs<ExtArgs>>): Prisma.PrismaPromise<BatchPayload>

    /**
     * Create or update one Agent_definitions.
     * @param {agent_definitionsUpsertArgs} args - Arguments to update or create a Agent_definitions.
     * @example
     * // Update or create a Agent_definitions
     * const agent_definitions = await prisma.agent_definitions.upsert({
     *   create: {
     *     // ... data to create a Agent_definitions
     *   },
     *   update: {
     *     // ... in case it already exists, update
     *   },
     *   where: {
     *     // ... the filter for the Agent_definitions we want to update
     *   }
     * })
     */
    upsert<T extends agent_definitionsUpsertArgs>(args: SelectSubset<T, agent_definitionsUpsertArgs<ExtArgs>>): Prisma__agent_definitionsClient<$Result.GetResult<Prisma.$agent_definitionsPayload<ExtArgs>, T, "upsert">, never, ExtArgs>


    /**
     * Count the number of Agent_definitions.
     * Note, that providing `undefined` is treated as the value not being there.
     * Read more here: https://pris.ly/d/null-undefined
     * @param {agent_definitionsCountArgs} args - Arguments to filter Agent_definitions to count.
     * @example
     * // Count the number of Agent_definitions
     * const count = await prisma.agent_definitions.count({
     *   where: {
     *     // ... the filter for the Agent_definitions we want to count
     *   }
     * })
    **/
    count<T extends agent_definitionsCountArgs>(
      args?: Subset<T, agent_definitionsCountArgs>,
    ): Prisma.PrismaPromise<
      T extends $Utils.Record<'select', any>
        ? T['select'] extends true
          ? number
          : GetScalarType<T['select'], Agent_definitionsCountAggregateOutputType>
        : number
    >

    /**
     * Allows you to perform aggregations operations on a Agent_definitions.
     * Note, that providing `undefined` is treated as the value not being there.
     * Read more here: https://pris.ly/d/null-undefined
     * @param {Agent_definitionsAggregateArgs} args - Select which aggregations you would like to apply and on what fields.
     * @example
     * // Ordered by age ascending
     * // Where email contains prisma.io
     * // Limited to the 10 users
     * const aggregations = await prisma.user.aggregate({
     *   _avg: {
     *     age: true,
     *   },
     *   where: {
     *     email: {
     *       contains: "prisma.io",
     *     },
     *   },
     *   orderBy: {
     *     age: "asc",
     *   },
     *   take: 10,
     * })
    **/
    aggregate<T extends Agent_definitionsAggregateArgs>(args: Subset<T, Agent_definitionsAggregateArgs>): Prisma.PrismaPromise<GetAgent_definitionsAggregateType<T>>

    /**
     * Group by Agent_definitions.
     * Note, that providing `undefined` is treated as the value not being there.
     * Read more here: https://pris.ly/d/null-undefined
     * @param {agent_definitionsGroupByArgs} args - Group by arguments.
     * @example
     * // Group by city, order by createdAt, get count
     * const result = await prisma.user.groupBy({
     *   by: ['city', 'createdAt'],
     *   orderBy: {
     *     createdAt: true
     *   },
     *   _count: {
     *     _all: true
     *   },
     * })
     * 
    **/
    groupBy<
      T extends agent_definitionsGroupByArgs,
      HasSelectOrTake extends Or<
        Extends<'skip', Keys<T>>,
        Extends<'take', Keys<T>>
      >,
      OrderByArg extends True extends HasSelectOrTake
        ? { orderBy: agent_definitionsGroupByArgs['orderBy'] }
        : { orderBy?: agent_definitionsGroupByArgs['orderBy'] },
      OrderFields extends ExcludeUnderscoreKeys<Keys<MaybeTupleToUnion<T['orderBy']>>>,
      ByFields extends MaybeTupleToUnion<T['by']>,
      ByValid extends Has<ByFields, OrderFields>,
      HavingFields extends GetHavingFields<T['having']>,
      HavingValid extends Has<ByFields, HavingFields>,
      ByEmpty extends T['by'] extends never[] ? True : False,
      InputErrors extends ByEmpty extends True
      ? `Error: "by" must not be empty.`
      : HavingValid extends False
      ? {
          [P in HavingFields]: P extends ByFields
            ? never
            : P extends string
            ? `Error: Field "${P}" used in "having" needs to be provided in "by".`
            : [
                Error,
                'Field ',
                P,
                ` in "having" needs to be provided in "by"`,
              ]
        }[HavingFields]
      : 'take' extends Keys<T>
      ? 'orderBy' extends Keys<T>
        ? ByValid extends True
          ? {}
          : {
              [P in OrderFields]: P extends ByFields
                ? never
                : `Error: Field "${P}" in "orderBy" needs to be provided in "by"`
            }[OrderFields]
        : 'Error: If you provide "take", you also need to provide "orderBy"'
      : 'skip' extends Keys<T>
      ? 'orderBy' extends Keys<T>
        ? ByValid extends True
          ? {}
          : {
              [P in OrderFields]: P extends ByFields
                ? never
                : `Error: Field "${P}" in "orderBy" needs to be provided in "by"`
            }[OrderFields]
        : 'Error: If you provide "skip", you also need to provide "orderBy"'
      : ByValid extends True
      ? {}
      : {
          [P in OrderFields]: P extends ByFields
            ? never
            : `Error: Field "${P}" in "orderBy" needs to be provided in "by"`
        }[OrderFields]
    >(args: SubsetIntersection<T, agent_definitionsGroupByArgs, OrderByArg> & InputErrors): {} extends InputErrors ? GetAgent_definitionsGroupByPayload<T> : Prisma.PrismaPromise<InputErrors>
  /**
   * Fields of the agent_definitions model
   */
  readonly fields: agent_definitionsFieldRefs;
  }

  /**
   * The delegate class that acts as a "Promise-like" for agent_definitions.
   * Why is this prefixed with `Prisma__`?
   * Because we want to prevent naming conflicts as mentioned in
   * https://github.com/prisma/prisma-client-js/issues/707
   */
  export interface Prisma__agent_definitionsClient<T, Null = never, ExtArgs extends $Extensions.InternalArgs = $Extensions.DefaultArgs> extends Prisma.PrismaPromise<T> {
    readonly [Symbol.toStringTag]: "PrismaPromise"
    /**
     * Attaches callbacks for the resolution and/or rejection of the Promise.
     * @param onfulfilled The callback to execute when the Promise is resolved.
     * @param onrejected The callback to execute when the Promise is rejected.
     * @returns A Promise for the completion of which ever callback is executed.
     */
    then<TResult1 = T, TResult2 = never>(onfulfilled?: ((value: T) => TResult1 | PromiseLike<TResult1>) | undefined | null, onrejected?: ((reason: any) => TResult2 | PromiseLike<TResult2>) | undefined | null): $Utils.JsPromise<TResult1 | TResult2>
    /**
     * Attaches a callback for only the rejection of the Promise.
     * @param onrejected The callback to execute when the Promise is rejected.
     * @returns A Promise for the completion of the callback.
     */
    catch<TResult = never>(onrejected?: ((reason: any) => TResult | PromiseLike<TResult>) | undefined | null): $Utils.JsPromise<T | TResult>
    /**
     * Attaches a callback that is invoked when the Promise is settled (fulfilled or rejected). The
     * resolved value cannot be modified from the callback.
     * @param onfinally The callback to execute when the Promise is settled (fulfilled or rejected).
     * @returns A Promise for the completion of the callback.
     */
    finally(onfinally?: (() => void) | undefined | null): $Utils.JsPromise<T>
  }




  /**
   * Fields of the agent_definitions model
   */ 
  interface agent_definitionsFieldRefs {
    readonly id: FieldRef<"agent_definitions", 'String'>
    readonly displayName: FieldRef<"agent_definitions", 'String'>
    readonly description: FieldRef<"agent_definitions", 'String'>
    readonly category: FieldRef<"agent_definitions", 'String'>
    readonly inputSchema: FieldRef<"agent_definitions", 'String'>
    readonly outputSchema: FieldRef<"agent_definitions", 'String'>
    readonly variableBindings: FieldRef<"agent_definitions", 'String'>
    readonly capabilities: FieldRef<"agent_definitions", 'String'>
    readonly defaultMaxTokens: FieldRef<"agent_definitions", 'Int'>
    readonly defaultTemperature: FieldRef<"agent_definitions", 'Float'>
    readonly schemaVersion: FieldRef<"agent_definitions", 'Int'>
    readonly source: FieldRef<"agent_definitions", 'String'>
    readonly managedByCode: FieldRef<"agent_definitions", 'Boolean'>
    readonly createdAt: FieldRef<"agent_definitions", 'DateTime'>
    readonly updatedAt: FieldRef<"agent_definitions", 'DateTime'>
  }
    

  // Custom InputTypes
  /**
   * agent_definitions findUnique
   */
  export type agent_definitionsFindUniqueArgs<ExtArgs extends $Extensions.InternalArgs = $Extensions.DefaultArgs> = {
    /**
     * Select specific fields to fetch from the agent_definitions
     */
    select?: agent_definitionsSelect<ExtArgs> | null
    /**
     * Filter, which agent_definitions to fetch.
     */
    where: agent_definitionsWhereUniqueInput
  }

  /**
   * agent_definitions findUniqueOrThrow
   */
  export type agent_definitionsFindUniqueOrThrowArgs<ExtArgs extends $Extensions.InternalArgs = $Extensions.DefaultArgs> = {
    /**
     * Select specific fields to fetch from the agent_definitions
     */
    select?: agent_definitionsSelect<ExtArgs> | null
    /**
     * Filter, which agent_definitions to fetch.
     */
    where: agent_definitionsWhereUniqueInput
  }

  /**
   * agent_definitions findFirst
   */
  export type agent_definitionsFindFirstArgs<ExtArgs extends $Extensions.InternalArgs = $Extensions.DefaultArgs> = {
    /**
     * Select specific fields to fetch from the agent_definitions
     */
    select?: agent_definitionsSelect<ExtArgs> | null
    /**
     * Filter, which agent_definitions to fetch.
     */
    where?: agent_definitionsWhereInput
    /**
     * {@link https://www.prisma.io/docs/concepts/components/prisma-client/sorting Sorting Docs}
     * 
     * Determine the order of agent_definitions to fetch.
     */
    orderBy?: agent_definitionsOrderByWithRelationInput | agent_definitionsOrderByWithRelationInput[]
    /**
     * {@link https://www.prisma.io/docs/concepts/components/prisma-client/pagination#cursor-based-pagination Cursor Docs}
     * 
     * Sets the position for searching for agent_definitions.
     */
    cursor?: agent_definitionsWhereUniqueInput
    /**
     * {@link https://www.prisma.io/docs/concepts/components/prisma-client/pagination Pagination Docs}
     * 
     * Take `±n` agent_definitions from the position of the cursor.
     */
    take?: number
    /**
     * {@link https://www.prisma.io/docs/concepts/components/prisma-client/pagination Pagination Docs}
     * 
     * Skip the first `n` agent_definitions.
     */
    skip?: number
    /**
     * {@link https://www.prisma.io/docs/concepts/components/prisma-client/distinct Distinct Docs}
     * 
     * Filter by unique combinations of agent_definitions.
     */
    distinct?: Agent_definitionsScalarFieldEnum | Agent_definitionsScalarFieldEnum[]
  }

  /**
   * agent_definitions findFirstOrThrow
   */
  export type agent_definitionsFindFirstOrThrowArgs<ExtArgs extends $Extensions.InternalArgs = $Extensions.DefaultArgs> = {
    /**
     * Select specific fields to fetch from the agent_definitions
     */
    select?: agent_definitionsSelect<ExtArgs> | null
    /**
     * Filter, which agent_definitions to fetch.
     */
    where?: agent_definitionsWhereInput
    /**
     * {@link https://www.prisma.io/docs/concepts/components/prisma-client/sorting Sorting Docs}
     * 
     * Determine the order of agent_definitions to fetch.
     */
    orderBy?: agent_definitionsOrderByWithRelationInput | agent_definitionsOrderByWithRelationInput[]
    /**
     * {@link https://www.prisma.io/docs/concepts/components/prisma-client/pagination#cursor-based-pagination Cursor Docs}
     * 
     * Sets the position for searching for agent_definitions.
     */
    cursor?: agent_definitionsWhereUniqueInput
    /**
     * {@link https://www.prisma.io/docs/concepts/components/prisma-client/pagination Pagination Docs}
     * 
     * Take `±n` agent_definitions from the position of the cursor.
     */
    take?: number
    /**
     * {@link https://www.prisma.io/docs/concepts/components/prisma-client/pagination Pagination Docs}
     * 
     * Skip the first `n` agent_definitions.
     */
    skip?: number
    /**
     * {@link https://www.prisma.io/docs/concepts/components/prisma-client/distinct Distinct Docs}
     * 
     * Filter by unique combinations of agent_definitions.
     */
    distinct?: Agent_definitionsScalarFieldEnum | Agent_definitionsScalarFieldEnum[]
  }

  /**
   * agent_definitions findMany
   */
  export type agent_definitionsFindManyArgs<ExtArgs extends $Extensions.InternalArgs = $Extensions.DefaultArgs> = {
    /**
     * Select specific fields to fetch from the agent_definitions
     */
    select?: agent_definitionsSelect<ExtArgs> | null
    /**
     * Filter, which agent_definitions to fetch.
     */
    where?: agent_definitionsWhereInput
    /**
     * {@link https://www.prisma.io/docs/concepts/components/prisma-client/sorting Sorting Docs}
     * 
     * Determine the order of agent_definitions to fetch.
     */
    orderBy?: agent_definitionsOrderByWithRelationInput | agent_definitionsOrderByWithRelationInput[]
    /**
     * {@link https://www.prisma.io/docs/concepts/components/prisma-client/pagination#cursor-based-pagination Cursor Docs}
     * 
     * Sets the position for listing agent_definitions.
     */
    cursor?: agent_definitionsWhereUniqueInput
    /**
     * {@link https://www.prisma.io/docs/concepts/components/prisma-client/pagination Pagination Docs}
     * 
     * Take `±n` agent_definitions from the position of the cursor.
     */
    take?: number
    /**
     * {@link https://www.prisma.io/docs/concepts/components/prisma-client/pagination Pagination Docs}
     * 
     * Skip the first `n` agent_definitions.
     */
    skip?: number
    distinct?: Agent_definitionsScalarFieldEnum | Agent_definitionsScalarFieldEnum[]
  }

  /**
   * agent_definitions create
   */
  export type agent_definitionsCreateArgs<ExtArgs extends $Extensions.InternalArgs = $Extensions.DefaultArgs> = {
    /**
     * Select specific fields to fetch from the agent_definitions
     */
    select?: agent_definitionsSelect<ExtArgs> | null
    /**
     * The data needed to create a agent_definitions.
     */
    data: XOR<agent_definitionsCreateInput, agent_definitionsUncheckedCreateInput>
  }

  /**
   * agent_definitions createMany
   */
  export type agent_definitionsCreateManyArgs<ExtArgs extends $Extensions.InternalArgs = $Extensions.DefaultArgs> = {
    /**
     * The data used to create many agent_definitions.
     */
    data: agent_definitionsCreateManyInput | agent_definitionsCreateManyInput[]
  }

  /**
   * agent_definitions createManyAndReturn
   */
  export type agent_definitionsCreateManyAndReturnArgs<ExtArgs extends $Extensions.InternalArgs = $Extensions.DefaultArgs> = {
    /**
     * Select specific fields to fetch from the agent_definitions
     */
    select?: agent_definitionsSelectCreateManyAndReturn<ExtArgs> | null
    /**
     * The data used to create many agent_definitions.
     */
    data: agent_definitionsCreateManyInput | agent_definitionsCreateManyInput[]
  }

  /**
   * agent_definitions update
   */
  export type agent_definitionsUpdateArgs<ExtArgs extends $Extensions.InternalArgs = $Extensions.DefaultArgs> = {
    /**
     * Select specific fields to fetch from the agent_definitions
     */
    select?: agent_definitionsSelect<ExtArgs> | null
    /**
     * The data needed to update a agent_definitions.
     */
    data: XOR<agent_definitionsUpdateInput, agent_definitionsUncheckedUpdateInput>
    /**
     * Choose, which agent_definitions to update.
     */
    where: agent_definitionsWhereUniqueInput
  }

  /**
   * agent_definitions updateMany
   */
  export type agent_definitionsUpdateManyArgs<ExtArgs extends $Extensions.InternalArgs = $Extensions.DefaultArgs> = {
    /**
     * The data used to update agent_definitions.
     */
    data: XOR<agent_definitionsUpdateManyMutationInput, agent_definitionsUncheckedUpdateManyInput>
    /**
     * Filter which agent_definitions to update
     */
    where?: agent_definitionsWhereInput
  }

  /**
   * agent_definitions upsert
   */
  export type agent_definitionsUpsertArgs<ExtArgs extends $Extensions.InternalArgs = $Extensions.DefaultArgs> = {
    /**
     * Select specific fields to fetch from the agent_definitions
     */
    select?: agent_definitionsSelect<ExtArgs> | null
    /**
     * The filter to search for the agent_definitions to update in case it exists.
     */
    where: agent_definitionsWhereUniqueInput
    /**
     * In case the agent_definitions found by the `where` argument doesn't exist, create a new agent_definitions with this data.
     */
    create: XOR<agent_definitionsCreateInput, agent_definitionsUncheckedCreateInput>
    /**
     * In case the agent_definitions was found with the provided `where` argument, update it with this data.
     */
    update: XOR<agent_definitionsUpdateInput, agent_definitionsUncheckedUpdateInput>
  }

  /**
   * agent_definitions delete
   */
  export type agent_definitionsDeleteArgs<ExtArgs extends $Extensions.InternalArgs = $Extensions.DefaultArgs> = {
    /**
     * Select specific fields to fetch from the agent_definitions
     */
    select?: agent_definitionsSelect<ExtArgs> | null
    /**
     * Filter which agent_definitions to delete.
     */
    where: agent_definitionsWhereUniqueInput
  }

  /**
   * agent_definitions deleteMany
   */
  export type agent_definitionsDeleteManyArgs<ExtArgs extends $Extensions.InternalArgs = $Extensions.DefaultArgs> = {
    /**
     * Filter which agent_definitions to delete
     */
    where?: agent_definitionsWhereInput
  }

  /**
   * agent_definitions without action
   */
  export type agent_definitionsDefaultArgs<ExtArgs extends $Extensions.InternalArgs = $Extensions.DefaultArgs> = {
    /**
     * Select specific fields to fetch from the agent_definitions
     */
    select?: agent_definitionsSelect<ExtArgs> | null
  }


  /**
   * Model orchestrator_definitions
   */

  export type AggregateOrchestrator_definitions = {
    _count: Orchestrator_definitionsCountAggregateOutputType | null
    _min: Orchestrator_definitionsMinAggregateOutputType | null
    _max: Orchestrator_definitionsMaxAggregateOutputType | null
  }

  export type Orchestrator_definitionsMinAggregateOutputType = {
    id: string | null
    displayName: string | null
    description: string | null
    category: string | null
    steps: string | null
    variableGraph: string | null
    source: string | null
    managedByCode: boolean | null
    createdAt: Date | null
    updatedAt: Date | null
  }

  export type Orchestrator_definitionsMaxAggregateOutputType = {
    id: string | null
    displayName: string | null
    description: string | null
    category: string | null
    steps: string | null
    variableGraph: string | null
    source: string | null
    managedByCode: boolean | null
    createdAt: Date | null
    updatedAt: Date | null
  }

  export type Orchestrator_definitionsCountAggregateOutputType = {
    id: number
    displayName: number
    description: number
    category: number
    steps: number
    variableGraph: number
    source: number
    managedByCode: number
    createdAt: number
    updatedAt: number
    _all: number
  }


  export type Orchestrator_definitionsMinAggregateInputType = {
    id?: true
    displayName?: true
    description?: true
    category?: true
    steps?: true
    variableGraph?: true
    source?: true
    managedByCode?: true
    createdAt?: true
    updatedAt?: true
  }

  export type Orchestrator_definitionsMaxAggregateInputType = {
    id?: true
    displayName?: true
    description?: true
    category?: true
    steps?: true
    variableGraph?: true
    source?: true
    managedByCode?: true
    createdAt?: true
    updatedAt?: true
  }

  export type Orchestrator_definitionsCountAggregateInputType = {
    id?: true
    displayName?: true
    description?: true
    category?: true
    steps?: true
    variableGraph?: true
    source?: true
    managedByCode?: true
    createdAt?: true
    updatedAt?: true
    _all?: true
  }

  export type Orchestrator_definitionsAggregateArgs<ExtArgs extends $Extensions.InternalArgs = $Extensions.DefaultArgs> = {
    /**
     * Filter which orchestrator_definitions to aggregate.
     */
    where?: orchestrator_definitionsWhereInput
    /**
     * {@link https://www.prisma.io/docs/concepts/components/prisma-client/sorting Sorting Docs}
     * 
     * Determine the order of orchestrator_definitions to fetch.
     */
    orderBy?: orchestrator_definitionsOrderByWithRelationInput | orchestrator_definitionsOrderByWithRelationInput[]
    /**
     * {@link https://www.prisma.io/docs/concepts/components/prisma-client/pagination#cursor-based-pagination Cursor Docs}
     * 
     * Sets the start position
     */
    cursor?: orchestrator_definitionsWhereUniqueInput
    /**
     * {@link https://www.prisma.io/docs/concepts/components/prisma-client/pagination Pagination Docs}
     * 
     * Take `±n` orchestrator_definitions from the position of the cursor.
     */
    take?: number
    /**
     * {@link https://www.prisma.io/docs/concepts/components/prisma-client/pagination Pagination Docs}
     * 
     * Skip the first `n` orchestrator_definitions.
     */
    skip?: number
    /**
     * {@link https://www.prisma.io/docs/concepts/components/prisma-client/aggregations Aggregation Docs}
     * 
     * Count returned orchestrator_definitions
    **/
    _count?: true | Orchestrator_definitionsCountAggregateInputType
    /**
     * {@link https://www.prisma.io/docs/concepts/components/prisma-client/aggregations Aggregation Docs}
     * 
     * Select which fields to find the minimum value
    **/
    _min?: Orchestrator_definitionsMinAggregateInputType
    /**
     * {@link https://www.prisma.io/docs/concepts/components/prisma-client/aggregations Aggregation Docs}
     * 
     * Select which fields to find the maximum value
    **/
    _max?: Orchestrator_definitionsMaxAggregateInputType
  }

  export type GetOrchestrator_definitionsAggregateType<T extends Orchestrator_definitionsAggregateArgs> = {
        [P in keyof T & keyof AggregateOrchestrator_definitions]: P extends '_count' | 'count'
      ? T[P] extends true
        ? number
        : GetScalarType<T[P], AggregateOrchestrator_definitions[P]>
      : GetScalarType<T[P], AggregateOrchestrator_definitions[P]>
  }




  export type orchestrator_definitionsGroupByArgs<ExtArgs extends $Extensions.InternalArgs = $Extensions.DefaultArgs> = {
    where?: orchestrator_definitionsWhereInput
    orderBy?: orchestrator_definitionsOrderByWithAggregationInput | orchestrator_definitionsOrderByWithAggregationInput[]
    by: Orchestrator_definitionsScalarFieldEnum[] | Orchestrator_definitionsScalarFieldEnum
    having?: orchestrator_definitionsScalarWhereWithAggregatesInput
    take?: number
    skip?: number
    _count?: Orchestrator_definitionsCountAggregateInputType | true
    _min?: Orchestrator_definitionsMinAggregateInputType
    _max?: Orchestrator_definitionsMaxAggregateInputType
  }

  export type Orchestrator_definitionsGroupByOutputType = {
    id: string
    displayName: string
    description: string | null
    category: string
    steps: string
    variableGraph: string | null
    source: string
    managedByCode: boolean
    createdAt: Date
    updatedAt: Date
    _count: Orchestrator_definitionsCountAggregateOutputType | null
    _min: Orchestrator_definitionsMinAggregateOutputType | null
    _max: Orchestrator_definitionsMaxAggregateOutputType | null
  }

  type GetOrchestrator_definitionsGroupByPayload<T extends orchestrator_definitionsGroupByArgs> = Prisma.PrismaPromise<
    Array<
      PickEnumerable<Orchestrator_definitionsGroupByOutputType, T['by']> &
        {
          [P in ((keyof T) & (keyof Orchestrator_definitionsGroupByOutputType))]: P extends '_count'
            ? T[P] extends boolean
              ? number
              : GetScalarType<T[P], Orchestrator_definitionsGroupByOutputType[P]>
            : GetScalarType<T[P], Orchestrator_definitionsGroupByOutputType[P]>
        }
      >
    >


  export type orchestrator_definitionsSelect<ExtArgs extends $Extensions.InternalArgs = $Extensions.DefaultArgs> = $Extensions.GetSelect<{
    id?: boolean
    displayName?: boolean
    description?: boolean
    category?: boolean
    steps?: boolean
    variableGraph?: boolean
    source?: boolean
    managedByCode?: boolean
    createdAt?: boolean
    updatedAt?: boolean
  }, ExtArgs["result"]["orchestrator_definitions"]>

  export type orchestrator_definitionsSelectCreateManyAndReturn<ExtArgs extends $Extensions.InternalArgs = $Extensions.DefaultArgs> = $Extensions.GetSelect<{
    id?: boolean
    displayName?: boolean
    description?: boolean
    category?: boolean
    steps?: boolean
    variableGraph?: boolean
    source?: boolean
    managedByCode?: boolean
    createdAt?: boolean
    updatedAt?: boolean
  }, ExtArgs["result"]["orchestrator_definitions"]>

  export type orchestrator_definitionsSelectScalar = {
    id?: boolean
    displayName?: boolean
    description?: boolean
    category?: boolean
    steps?: boolean
    variableGraph?: boolean
    source?: boolean
    managedByCode?: boolean
    createdAt?: boolean
    updatedAt?: boolean
  }


  export type $orchestrator_definitionsPayload<ExtArgs extends $Extensions.InternalArgs = $Extensions.DefaultArgs> = {
    name: "orchestrator_definitions"
    objects: {}
    scalars: $Extensions.GetPayloadResult<{
      id: string
      displayName: string
      description: string | null
      category: string
      steps: string
      variableGraph: string | null
      source: string
      managedByCode: boolean
      createdAt: Date
      updatedAt: Date
    }, ExtArgs["result"]["orchestrator_definitions"]>
    composites: {}
  }

  type orchestrator_definitionsGetPayload<S extends boolean | null | undefined | orchestrator_definitionsDefaultArgs> = $Result.GetResult<Prisma.$orchestrator_definitionsPayload, S>

  type orchestrator_definitionsCountArgs<ExtArgs extends $Extensions.InternalArgs = $Extensions.DefaultArgs> = 
    Omit<orchestrator_definitionsFindManyArgs, 'select' | 'include' | 'distinct'> & {
      select?: Orchestrator_definitionsCountAggregateInputType | true
    }

  export interface orchestrator_definitionsDelegate<ExtArgs extends $Extensions.InternalArgs = $Extensions.DefaultArgs> {
    [K: symbol]: { types: Prisma.TypeMap<ExtArgs>['model']['orchestrator_definitions'], meta: { name: 'orchestrator_definitions' } }
    /**
     * Find zero or one Orchestrator_definitions that matches the filter.
     * @param {orchestrator_definitionsFindUniqueArgs} args - Arguments to find a Orchestrator_definitions
     * @example
     * // Get one Orchestrator_definitions
     * const orchestrator_definitions = await prisma.orchestrator_definitions.findUnique({
     *   where: {
     *     // ... provide filter here
     *   }
     * })
     */
    findUnique<T extends orchestrator_definitionsFindUniqueArgs>(args: SelectSubset<T, orchestrator_definitionsFindUniqueArgs<ExtArgs>>): Prisma__orchestrator_definitionsClient<$Result.GetResult<Prisma.$orchestrator_definitionsPayload<ExtArgs>, T, "findUnique"> | null, null, ExtArgs>

    /**
     * Find one Orchestrator_definitions that matches the filter or throw an error with `error.code='P2025'` 
     * if no matches were found.
     * @param {orchestrator_definitionsFindUniqueOrThrowArgs} args - Arguments to find a Orchestrator_definitions
     * @example
     * // Get one Orchestrator_definitions
     * const orchestrator_definitions = await prisma.orchestrator_definitions.findUniqueOrThrow({
     *   where: {
     *     // ... provide filter here
     *   }
     * })
     */
    findUniqueOrThrow<T extends orchestrator_definitionsFindUniqueOrThrowArgs>(args: SelectSubset<T, orchestrator_definitionsFindUniqueOrThrowArgs<ExtArgs>>): Prisma__orchestrator_definitionsClient<$Result.GetResult<Prisma.$orchestrator_definitionsPayload<ExtArgs>, T, "findUniqueOrThrow">, never, ExtArgs>

    /**
     * Find the first Orchestrator_definitions that matches the filter.
     * Note, that providing `undefined` is treated as the value not being there.
     * Read more here: https://pris.ly/d/null-undefined
     * @param {orchestrator_definitionsFindFirstArgs} args - Arguments to find a Orchestrator_definitions
     * @example
     * // Get one Orchestrator_definitions
     * const orchestrator_definitions = await prisma.orchestrator_definitions.findFirst({
     *   where: {
     *     // ... provide filter here
     *   }
     * })
     */
    findFirst<T extends orchestrator_definitionsFindFirstArgs>(args?: SelectSubset<T, orchestrator_definitionsFindFirstArgs<ExtArgs>>): Prisma__orchestrator_definitionsClient<$Result.GetResult<Prisma.$orchestrator_definitionsPayload<ExtArgs>, T, "findFirst"> | null, null, ExtArgs>

    /**
     * Find the first Orchestrator_definitions that matches the filter or
     * throw `PrismaKnownClientError` with `P2025` code if no matches were found.
     * Note, that providing `undefined` is treated as the value not being there.
     * Read more here: https://pris.ly/d/null-undefined
     * @param {orchestrator_definitionsFindFirstOrThrowArgs} args - Arguments to find a Orchestrator_definitions
     * @example
     * // Get one Orchestrator_definitions
     * const orchestrator_definitions = await prisma.orchestrator_definitions.findFirstOrThrow({
     *   where: {
     *     // ... provide filter here
     *   }
     * })
     */
    findFirstOrThrow<T extends orchestrator_definitionsFindFirstOrThrowArgs>(args?: SelectSubset<T, orchestrator_definitionsFindFirstOrThrowArgs<ExtArgs>>): Prisma__orchestrator_definitionsClient<$Result.GetResult<Prisma.$orchestrator_definitionsPayload<ExtArgs>, T, "findFirstOrThrow">, never, ExtArgs>

    /**
     * Find zero or more Orchestrator_definitions that matches the filter.
     * Note, that providing `undefined` is treated as the value not being there.
     * Read more here: https://pris.ly/d/null-undefined
     * @param {orchestrator_definitionsFindManyArgs} args - Arguments to filter and select certain fields only.
     * @example
     * // Get all Orchestrator_definitions
     * const orchestrator_definitions = await prisma.orchestrator_definitions.findMany()
     * 
     * // Get first 10 Orchestrator_definitions
     * const orchestrator_definitions = await prisma.orchestrator_definitions.findMany({ take: 10 })
     * 
     * // Only select the `id`
     * const orchestrator_definitionsWithIdOnly = await prisma.orchestrator_definitions.findMany({ select: { id: true } })
     * 
     */
    findMany<T extends orchestrator_definitionsFindManyArgs>(args?: SelectSubset<T, orchestrator_definitionsFindManyArgs<ExtArgs>>): Prisma.PrismaPromise<$Result.GetResult<Prisma.$orchestrator_definitionsPayload<ExtArgs>, T, "findMany">>

    /**
     * Create a Orchestrator_definitions.
     * @param {orchestrator_definitionsCreateArgs} args - Arguments to create a Orchestrator_definitions.
     * @example
     * // Create one Orchestrator_definitions
     * const Orchestrator_definitions = await prisma.orchestrator_definitions.create({
     *   data: {
     *     // ... data to create a Orchestrator_definitions
     *   }
     * })
     * 
     */
    create<T extends orchestrator_definitionsCreateArgs>(args: SelectSubset<T, orchestrator_definitionsCreateArgs<ExtArgs>>): Prisma__orchestrator_definitionsClient<$Result.GetResult<Prisma.$orchestrator_definitionsPayload<ExtArgs>, T, "create">, never, ExtArgs>

    /**
     * Create many Orchestrator_definitions.
     * @param {orchestrator_definitionsCreateManyArgs} args - Arguments to create many Orchestrator_definitions.
     * @example
     * // Create many Orchestrator_definitions
     * const orchestrator_definitions = await prisma.orchestrator_definitions.createMany({
     *   data: [
     *     // ... provide data here
     *   ]
     * })
     *     
     */
    createMany<T extends orchestrator_definitionsCreateManyArgs>(args?: SelectSubset<T, orchestrator_definitionsCreateManyArgs<ExtArgs>>): Prisma.PrismaPromise<BatchPayload>

    /**
     * Create many Orchestrator_definitions and returns the data saved in the database.
     * @param {orchestrator_definitionsCreateManyAndReturnArgs} args - Arguments to create many Orchestrator_definitions.
     * @example
     * // Create many Orchestrator_definitions
     * const orchestrator_definitions = await prisma.orchestrator_definitions.createManyAndReturn({
     *   data: [
     *     // ... provide data here
     *   ]
     * })
     * 
     * // Create many Orchestrator_definitions and only return the `id`
     * const orchestrator_definitionsWithIdOnly = await prisma.orchestrator_definitions.createManyAndReturn({ 
     *   select: { id: true },
     *   data: [
     *     // ... provide data here
     *   ]
     * })
     * Note, that providing `undefined` is treated as the value not being there.
     * Read more here: https://pris.ly/d/null-undefined
     * 
     */
    createManyAndReturn<T extends orchestrator_definitionsCreateManyAndReturnArgs>(args?: SelectSubset<T, orchestrator_definitionsCreateManyAndReturnArgs<ExtArgs>>): Prisma.PrismaPromise<$Result.GetResult<Prisma.$orchestrator_definitionsPayload<ExtArgs>, T, "createManyAndReturn">>

    /**
     * Delete a Orchestrator_definitions.
     * @param {orchestrator_definitionsDeleteArgs} args - Arguments to delete one Orchestrator_definitions.
     * @example
     * // Delete one Orchestrator_definitions
     * const Orchestrator_definitions = await prisma.orchestrator_definitions.delete({
     *   where: {
     *     // ... filter to delete one Orchestrator_definitions
     *   }
     * })
     * 
     */
    delete<T extends orchestrator_definitionsDeleteArgs>(args: SelectSubset<T, orchestrator_definitionsDeleteArgs<ExtArgs>>): Prisma__orchestrator_definitionsClient<$Result.GetResult<Prisma.$orchestrator_definitionsPayload<ExtArgs>, T, "delete">, never, ExtArgs>

    /**
     * Update one Orchestrator_definitions.
     * @param {orchestrator_definitionsUpdateArgs} args - Arguments to update one Orchestrator_definitions.
     * @example
     * // Update one Orchestrator_definitions
     * const orchestrator_definitions = await prisma.orchestrator_definitions.update({
     *   where: {
     *     // ... provide filter here
     *   },
     *   data: {
     *     // ... provide data here
     *   }
     * })
     * 
     */
    update<T extends orchestrator_definitionsUpdateArgs>(args: SelectSubset<T, orchestrator_definitionsUpdateArgs<ExtArgs>>): Prisma__orchestrator_definitionsClient<$Result.GetResult<Prisma.$orchestrator_definitionsPayload<ExtArgs>, T, "update">, never, ExtArgs>

    /**
     * Delete zero or more Orchestrator_definitions.
     * @param {orchestrator_definitionsDeleteManyArgs} args - Arguments to filter Orchestrator_definitions to delete.
     * @example
     * // Delete a few Orchestrator_definitions
     * const { count } = await prisma.orchestrator_definitions.deleteMany({
     *   where: {
     *     // ... provide filter here
     *   }
     * })
     * 
     */
    deleteMany<T extends orchestrator_definitionsDeleteManyArgs>(args?: SelectSubset<T, orchestrator_definitionsDeleteManyArgs<ExtArgs>>): Prisma.PrismaPromise<BatchPayload>

    /**
     * Update zero or more Orchestrator_definitions.
     * Note, that providing `undefined` is treated as the value not being there.
     * Read more here: https://pris.ly/d/null-undefined
     * @param {orchestrator_definitionsUpdateManyArgs} args - Arguments to update one or more rows.
     * @example
     * // Update many Orchestrator_definitions
     * const orchestrator_definitions = await prisma.orchestrator_definitions.updateMany({
     *   where: {
     *     // ... provide filter here
     *   },
     *   data: {
     *     // ... provide data here
     *   }
     * })
     * 
     */
    updateMany<T extends orchestrator_definitionsUpdateManyArgs>(args: SelectSubset<T, orchestrator_definitionsUpdateManyArgs<ExtArgs>>): Prisma.PrismaPromise<BatchPayload>

    /**
     * Create or update one Orchestrator_definitions.
     * @param {orchestrator_definitionsUpsertArgs} args - Arguments to update or create a Orchestrator_definitions.
     * @example
     * // Update or create a Orchestrator_definitions
     * const orchestrator_definitions = await prisma.orchestrator_definitions.upsert({
     *   create: {
     *     // ... data to create a Orchestrator_definitions
     *   },
     *   update: {
     *     // ... in case it already exists, update
     *   },
     *   where: {
     *     // ... the filter for the Orchestrator_definitions we want to update
     *   }
     * })
     */
    upsert<T extends orchestrator_definitionsUpsertArgs>(args: SelectSubset<T, orchestrator_definitionsUpsertArgs<ExtArgs>>): Prisma__orchestrator_definitionsClient<$Result.GetResult<Prisma.$orchestrator_definitionsPayload<ExtArgs>, T, "upsert">, never, ExtArgs>


    /**
     * Count the number of Orchestrator_definitions.
     * Note, that providing `undefined` is treated as the value not being there.
     * Read more here: https://pris.ly/d/null-undefined
     * @param {orchestrator_definitionsCountArgs} args - Arguments to filter Orchestrator_definitions to count.
     * @example
     * // Count the number of Orchestrator_definitions
     * const count = await prisma.orchestrator_definitions.count({
     *   where: {
     *     // ... the filter for the Orchestrator_definitions we want to count
     *   }
     * })
    **/
    count<T extends orchestrator_definitionsCountArgs>(
      args?: Subset<T, orchestrator_definitionsCountArgs>,
    ): Prisma.PrismaPromise<
      T extends $Utils.Record<'select', any>
        ? T['select'] extends true
          ? number
          : GetScalarType<T['select'], Orchestrator_definitionsCountAggregateOutputType>
        : number
    >

    /**
     * Allows you to perform aggregations operations on a Orchestrator_definitions.
     * Note, that providing `undefined` is treated as the value not being there.
     * Read more here: https://pris.ly/d/null-undefined
     * @param {Orchestrator_definitionsAggregateArgs} args - Select which aggregations you would like to apply and on what fields.
     * @example
     * // Ordered by age ascending
     * // Where email contains prisma.io
     * // Limited to the 10 users
     * const aggregations = await prisma.user.aggregate({
     *   _avg: {
     *     age: true,
     *   },
     *   where: {
     *     email: {
     *       contains: "prisma.io",
     *     },
     *   },
     *   orderBy: {
     *     age: "asc",
     *   },
     *   take: 10,
     * })
    **/
    aggregate<T extends Orchestrator_definitionsAggregateArgs>(args: Subset<T, Orchestrator_definitionsAggregateArgs>): Prisma.PrismaPromise<GetOrchestrator_definitionsAggregateType<T>>

    /**
     * Group by Orchestrator_definitions.
     * Note, that providing `undefined` is treated as the value not being there.
     * Read more here: https://pris.ly/d/null-undefined
     * @param {orchestrator_definitionsGroupByArgs} args - Group by arguments.
     * @example
     * // Group by city, order by createdAt, get count
     * const result = await prisma.user.groupBy({
     *   by: ['city', 'createdAt'],
     *   orderBy: {
     *     createdAt: true
     *   },
     *   _count: {
     *     _all: true
     *   },
     * })
     * 
    **/
    groupBy<
      T extends orchestrator_definitionsGroupByArgs,
      HasSelectOrTake extends Or<
        Extends<'skip', Keys<T>>,
        Extends<'take', Keys<T>>
      >,
      OrderByArg extends True extends HasSelectOrTake
        ? { orderBy: orchestrator_definitionsGroupByArgs['orderBy'] }
        : { orderBy?: orchestrator_definitionsGroupByArgs['orderBy'] },
      OrderFields extends ExcludeUnderscoreKeys<Keys<MaybeTupleToUnion<T['orderBy']>>>,
      ByFields extends MaybeTupleToUnion<T['by']>,
      ByValid extends Has<ByFields, OrderFields>,
      HavingFields extends GetHavingFields<T['having']>,
      HavingValid extends Has<ByFields, HavingFields>,
      ByEmpty extends T['by'] extends never[] ? True : False,
      InputErrors extends ByEmpty extends True
      ? `Error: "by" must not be empty.`
      : HavingValid extends False
      ? {
          [P in HavingFields]: P extends ByFields
            ? never
            : P extends string
            ? `Error: Field "${P}" used in "having" needs to be provided in "by".`
            : [
                Error,
                'Field ',
                P,
                ` in "having" needs to be provided in "by"`,
              ]
        }[HavingFields]
      : 'take' extends Keys<T>
      ? 'orderBy' extends Keys<T>
        ? ByValid extends True
          ? {}
          : {
              [P in OrderFields]: P extends ByFields
                ? never
                : `Error: Field "${P}" in "orderBy" needs to be provided in "by"`
            }[OrderFields]
        : 'Error: If you provide "take", you also need to provide "orderBy"'
      : 'skip' extends Keys<T>
      ? 'orderBy' extends Keys<T>
        ? ByValid extends True
          ? {}
          : {
              [P in OrderFields]: P extends ByFields
                ? never
                : `Error: Field "${P}" in "orderBy" needs to be provided in "by"`
            }[OrderFields]
        : 'Error: If you provide "skip", you also need to provide "orderBy"'
      : ByValid extends True
      ? {}
      : {
          [P in OrderFields]: P extends ByFields
            ? never
            : `Error: Field "${P}" in "orderBy" needs to be provided in "by"`
        }[OrderFields]
    >(args: SubsetIntersection<T, orchestrator_definitionsGroupByArgs, OrderByArg> & InputErrors): {} extends InputErrors ? GetOrchestrator_definitionsGroupByPayload<T> : Prisma.PrismaPromise<InputErrors>
  /**
   * Fields of the orchestrator_definitions model
   */
  readonly fields: orchestrator_definitionsFieldRefs;
  }

  /**
   * The delegate class that acts as a "Promise-like" for orchestrator_definitions.
   * Why is this prefixed with `Prisma__`?
   * Because we want to prevent naming conflicts as mentioned in
   * https://github.com/prisma/prisma-client-js/issues/707
   */
  export interface Prisma__orchestrator_definitionsClient<T, Null = never, ExtArgs extends $Extensions.InternalArgs = $Extensions.DefaultArgs> extends Prisma.PrismaPromise<T> {
    readonly [Symbol.toStringTag]: "PrismaPromise"
    /**
     * Attaches callbacks for the resolution and/or rejection of the Promise.
     * @param onfulfilled The callback to execute when the Promise is resolved.
     * @param onrejected The callback to execute when the Promise is rejected.
     * @returns A Promise for the completion of which ever callback is executed.
     */
    then<TResult1 = T, TResult2 = never>(onfulfilled?: ((value: T) => TResult1 | PromiseLike<TResult1>) | undefined | null, onrejected?: ((reason: any) => TResult2 | PromiseLike<TResult2>) | undefined | null): $Utils.JsPromise<TResult1 | TResult2>
    /**
     * Attaches a callback for only the rejection of the Promise.
     * @param onrejected The callback to execute when the Promise is rejected.
     * @returns A Promise for the completion of the callback.
     */
    catch<TResult = never>(onrejected?: ((reason: any) => TResult | PromiseLike<TResult>) | undefined | null): $Utils.JsPromise<T | TResult>
    /**
     * Attaches a callback that is invoked when the Promise is settled (fulfilled or rejected). The
     * resolved value cannot be modified from the callback.
     * @param onfinally The callback to execute when the Promise is settled (fulfilled or rejected).
     * @returns A Promise for the completion of the callback.
     */
    finally(onfinally?: (() => void) | undefined | null): $Utils.JsPromise<T>
  }




  /**
   * Fields of the orchestrator_definitions model
   */ 
  interface orchestrator_definitionsFieldRefs {
    readonly id: FieldRef<"orchestrator_definitions", 'String'>
    readonly displayName: FieldRef<"orchestrator_definitions", 'String'>
    readonly description: FieldRef<"orchestrator_definitions", 'String'>
    readonly category: FieldRef<"orchestrator_definitions", 'String'>
    readonly steps: FieldRef<"orchestrator_definitions", 'String'>
    readonly variableGraph: FieldRef<"orchestrator_definitions", 'String'>
    readonly source: FieldRef<"orchestrator_definitions", 'String'>
    readonly managedByCode: FieldRef<"orchestrator_definitions", 'Boolean'>
    readonly createdAt: FieldRef<"orchestrator_definitions", 'DateTime'>
    readonly updatedAt: FieldRef<"orchestrator_definitions", 'DateTime'>
  }
    

  // Custom InputTypes
  /**
   * orchestrator_definitions findUnique
   */
  export type orchestrator_definitionsFindUniqueArgs<ExtArgs extends $Extensions.InternalArgs = $Extensions.DefaultArgs> = {
    /**
     * Select specific fields to fetch from the orchestrator_definitions
     */
    select?: orchestrator_definitionsSelect<ExtArgs> | null
    /**
     * Filter, which orchestrator_definitions to fetch.
     */
    where: orchestrator_definitionsWhereUniqueInput
  }

  /**
   * orchestrator_definitions findUniqueOrThrow
   */
  export type orchestrator_definitionsFindUniqueOrThrowArgs<ExtArgs extends $Extensions.InternalArgs = $Extensions.DefaultArgs> = {
    /**
     * Select specific fields to fetch from the orchestrator_definitions
     */
    select?: orchestrator_definitionsSelect<ExtArgs> | null
    /**
     * Filter, which orchestrator_definitions to fetch.
     */
    where: orchestrator_definitionsWhereUniqueInput
  }

  /**
   * orchestrator_definitions findFirst
   */
  export type orchestrator_definitionsFindFirstArgs<ExtArgs extends $Extensions.InternalArgs = $Extensions.DefaultArgs> = {
    /**
     * Select specific fields to fetch from the orchestrator_definitions
     */
    select?: orchestrator_definitionsSelect<ExtArgs> | null
    /**
     * Filter, which orchestrator_definitions to fetch.
     */
    where?: orchestrator_definitionsWhereInput
    /**
     * {@link https://www.prisma.io/docs/concepts/components/prisma-client/sorting Sorting Docs}
     * 
     * Determine the order of orchestrator_definitions to fetch.
     */
    orderBy?: orchestrator_definitionsOrderByWithRelationInput | orchestrator_definitionsOrderByWithRelationInput[]
    /**
     * {@link https://www.prisma.io/docs/concepts/components/prisma-client/pagination#cursor-based-pagination Cursor Docs}
     * 
     * Sets the position for searching for orchestrator_definitions.
     */
    cursor?: orchestrator_definitionsWhereUniqueInput
    /**
     * {@link https://www.prisma.io/docs/concepts/components/prisma-client/pagination Pagination Docs}
     * 
     * Take `±n` orchestrator_definitions from the position of the cursor.
     */
    take?: number
    /**
     * {@link https://www.prisma.io/docs/concepts/components/prisma-client/pagination Pagination Docs}
     * 
     * Skip the first `n` orchestrator_definitions.
     */
    skip?: number
    /**
     * {@link https://www.prisma.io/docs/concepts/components/prisma-client/distinct Distinct Docs}
     * 
     * Filter by unique combinations of orchestrator_definitions.
     */
    distinct?: Orchestrator_definitionsScalarFieldEnum | Orchestrator_definitionsScalarFieldEnum[]
  }

  /**
   * orchestrator_definitions findFirstOrThrow
   */
  export type orchestrator_definitionsFindFirstOrThrowArgs<ExtArgs extends $Extensions.InternalArgs = $Extensions.DefaultArgs> = {
    /**
     * Select specific fields to fetch from the orchestrator_definitions
     */
    select?: orchestrator_definitionsSelect<ExtArgs> | null
    /**
     * Filter, which orchestrator_definitions to fetch.
     */
    where?: orchestrator_definitionsWhereInput
    /**
     * {@link https://www.prisma.io/docs/concepts/components/prisma-client/sorting Sorting Docs}
     * 
     * Determine the order of orchestrator_definitions to fetch.
     */
    orderBy?: orchestrator_definitionsOrderByWithRelationInput | orchestrator_definitionsOrderByWithRelationInput[]
    /**
     * {@link https://www.prisma.io/docs/concepts/components/prisma-client/pagination#cursor-based-pagination Cursor Docs}
     * 
     * Sets the position for searching for orchestrator_definitions.
     */
    cursor?: orchestrator_definitionsWhereUniqueInput
    /**
     * {@link https://www.prisma.io/docs/concepts/components/prisma-client/pagination Pagination Docs}
     * 
     * Take `±n` orchestrator_definitions from the position of the cursor.
     */
    take?: number
    /**
     * {@link https://www.prisma.io/docs/concepts/components/prisma-client/pagination Pagination Docs}
     * 
     * Skip the first `n` orchestrator_definitions.
     */
    skip?: number
    /**
     * {@link https://www.prisma.io/docs/concepts/components/prisma-client/distinct Distinct Docs}
     * 
     * Filter by unique combinations of orchestrator_definitions.
     */
    distinct?: Orchestrator_definitionsScalarFieldEnum | Orchestrator_definitionsScalarFieldEnum[]
  }

  /**
   * orchestrator_definitions findMany
   */
  export type orchestrator_definitionsFindManyArgs<ExtArgs extends $Extensions.InternalArgs = $Extensions.DefaultArgs> = {
    /**
     * Select specific fields to fetch from the orchestrator_definitions
     */
    select?: orchestrator_definitionsSelect<ExtArgs> | null
    /**
     * Filter, which orchestrator_definitions to fetch.
     */
    where?: orchestrator_definitionsWhereInput
    /**
     * {@link https://www.prisma.io/docs/concepts/components/prisma-client/sorting Sorting Docs}
     * 
     * Determine the order of orchestrator_definitions to fetch.
     */
    orderBy?: orchestrator_definitionsOrderByWithRelationInput | orchestrator_definitionsOrderByWithRelationInput[]
    /**
     * {@link https://www.prisma.io/docs/concepts/components/prisma-client/pagination#cursor-based-pagination Cursor Docs}
     * 
     * Sets the position for listing orchestrator_definitions.
     */
    cursor?: orchestrator_definitionsWhereUniqueInput
    /**
     * {@link https://www.prisma.io/docs/concepts/components/prisma-client/pagination Pagination Docs}
     * 
     * Take `±n` orchestrator_definitions from the position of the cursor.
     */
    take?: number
    /**
     * {@link https://www.prisma.io/docs/concepts/components/prisma-client/pagination Pagination Docs}
     * 
     * Skip the first `n` orchestrator_definitions.
     */
    skip?: number
    distinct?: Orchestrator_definitionsScalarFieldEnum | Orchestrator_definitionsScalarFieldEnum[]
  }

  /**
   * orchestrator_definitions create
   */
  export type orchestrator_definitionsCreateArgs<ExtArgs extends $Extensions.InternalArgs = $Extensions.DefaultArgs> = {
    /**
     * Select specific fields to fetch from the orchestrator_definitions
     */
    select?: orchestrator_definitionsSelect<ExtArgs> | null
    /**
     * The data needed to create a orchestrator_definitions.
     */
    data: XOR<orchestrator_definitionsCreateInput, orchestrator_definitionsUncheckedCreateInput>
  }

  /**
   * orchestrator_definitions createMany
   */
  export type orchestrator_definitionsCreateManyArgs<ExtArgs extends $Extensions.InternalArgs = $Extensions.DefaultArgs> = {
    /**
     * The data used to create many orchestrator_definitions.
     */
    data: orchestrator_definitionsCreateManyInput | orchestrator_definitionsCreateManyInput[]
  }

  /**
   * orchestrator_definitions createManyAndReturn
   */
  export type orchestrator_definitionsCreateManyAndReturnArgs<ExtArgs extends $Extensions.InternalArgs = $Extensions.DefaultArgs> = {
    /**
     * Select specific fields to fetch from the orchestrator_definitions
     */
    select?: orchestrator_definitionsSelectCreateManyAndReturn<ExtArgs> | null
    /**
     * The data used to create many orchestrator_definitions.
     */
    data: orchestrator_definitionsCreateManyInput | orchestrator_definitionsCreateManyInput[]
  }

  /**
   * orchestrator_definitions update
   */
  export type orchestrator_definitionsUpdateArgs<ExtArgs extends $Extensions.InternalArgs = $Extensions.DefaultArgs> = {
    /**
     * Select specific fields to fetch from the orchestrator_definitions
     */
    select?: orchestrator_definitionsSelect<ExtArgs> | null
    /**
     * The data needed to update a orchestrator_definitions.
     */
    data: XOR<orchestrator_definitionsUpdateInput, orchestrator_definitionsUncheckedUpdateInput>
    /**
     * Choose, which orchestrator_definitions to update.
     */
    where: orchestrator_definitionsWhereUniqueInput
  }

  /**
   * orchestrator_definitions updateMany
   */
  export type orchestrator_definitionsUpdateManyArgs<ExtArgs extends $Extensions.InternalArgs = $Extensions.DefaultArgs> = {
    /**
     * The data used to update orchestrator_definitions.
     */
    data: XOR<orchestrator_definitionsUpdateManyMutationInput, orchestrator_definitionsUncheckedUpdateManyInput>
    /**
     * Filter which orchestrator_definitions to update
     */
    where?: orchestrator_definitionsWhereInput
  }

  /**
   * orchestrator_definitions upsert
   */
  export type orchestrator_definitionsUpsertArgs<ExtArgs extends $Extensions.InternalArgs = $Extensions.DefaultArgs> = {
    /**
     * Select specific fields to fetch from the orchestrator_definitions
     */
    select?: orchestrator_definitionsSelect<ExtArgs> | null
    /**
     * The filter to search for the orchestrator_definitions to update in case it exists.
     */
    where: orchestrator_definitionsWhereUniqueInput
    /**
     * In case the orchestrator_definitions found by the `where` argument doesn't exist, create a new orchestrator_definitions with this data.
     */
    create: XOR<orchestrator_definitionsCreateInput, orchestrator_definitionsUncheckedCreateInput>
    /**
     * In case the orchestrator_definitions was found with the provided `where` argument, update it with this data.
     */
    update: XOR<orchestrator_definitionsUpdateInput, orchestrator_definitionsUncheckedUpdateInput>
  }

  /**
   * orchestrator_definitions delete
   */
  export type orchestrator_definitionsDeleteArgs<ExtArgs extends $Extensions.InternalArgs = $Extensions.DefaultArgs> = {
    /**
     * Select specific fields to fetch from the orchestrator_definitions
     */
    select?: orchestrator_definitionsSelect<ExtArgs> | null
    /**
     * Filter which orchestrator_definitions to delete.
     */
    where: orchestrator_definitionsWhereUniqueInput
  }

  /**
   * orchestrator_definitions deleteMany
   */
  export type orchestrator_definitionsDeleteManyArgs<ExtArgs extends $Extensions.InternalArgs = $Extensions.DefaultArgs> = {
    /**
     * Filter which orchestrator_definitions to delete
     */
    where?: orchestrator_definitionsWhereInput
  }

  /**
   * orchestrator_definitions without action
   */
  export type orchestrator_definitionsDefaultArgs<ExtArgs extends $Extensions.InternalArgs = $Extensions.DefaultArgs> = {
    /**
     * Select specific fields to fetch from the orchestrator_definitions
     */
    select?: orchestrator_definitionsSelect<ExtArgs> | null
  }


  /**
   * Model agent_registrations
   */

  export type AggregateAgent_registrations = {
    _count: Agent_registrationsCountAggregateOutputType | null
    _avg: Agent_registrationsAvgAggregateOutputType | null
    _sum: Agent_registrationsSumAggregateOutputType | null
    _min: Agent_registrationsMinAggregateOutputType | null
    _max: Agent_registrationsMaxAggregateOutputType | null
  }

  export type Agent_registrationsAvgAggregateOutputType = {
    callCount: number | null
    successRate: number | null
  }

  export type Agent_registrationsSumAggregateOutputType = {
    callCount: number | null
    successRate: number | null
  }

  export type Agent_registrationsMinAggregateOutputType = {
    id: string | null
    name: string | null
    type: string | null
    category: string | null
    description: string | null
    version: string | null
    config: string | null
    inputSchema: string | null
    outputSchema: string | null
    capabilities: string | null
    subscribes: string | null
    publishes: string | null
    callCount: number | null
    successRate: number | null
    createdAt: Date | null
    updatedAt: Date | null
    endpoint: string | null
  }

  export type Agent_registrationsMaxAggregateOutputType = {
    id: string | null
    name: string | null
    type: string | null
    category: string | null
    description: string | null
    version: string | null
    config: string | null
    inputSchema: string | null
    outputSchema: string | null
    capabilities: string | null
    subscribes: string | null
    publishes: string | null
    callCount: number | null
    successRate: number | null
    createdAt: Date | null
    updatedAt: Date | null
    endpoint: string | null
  }

  export type Agent_registrationsCountAggregateOutputType = {
    id: number
    name: number
    type: number
    category: number
    description: number
    version: number
    config: number
    inputSchema: number
    outputSchema: number
    capabilities: number
    subscribes: number
    publishes: number
    callCount: number
    successRate: number
    createdAt: number
    updatedAt: number
    endpoint: number
    _all: number
  }


  export type Agent_registrationsAvgAggregateInputType = {
    callCount?: true
    successRate?: true
  }

  export type Agent_registrationsSumAggregateInputType = {
    callCount?: true
    successRate?: true
  }

  export type Agent_registrationsMinAggregateInputType = {
    id?: true
    name?: true
    type?: true
    category?: true
    description?: true
    version?: true
    config?: true
    inputSchema?: true
    outputSchema?: true
    capabilities?: true
    subscribes?: true
    publishes?: true
    callCount?: true
    successRate?: true
    createdAt?: true
    updatedAt?: true
    endpoint?: true
  }

  export type Agent_registrationsMaxAggregateInputType = {
    id?: true
    name?: true
    type?: true
    category?: true
    description?: true
    version?: true
    config?: true
    inputSchema?: true
    outputSchema?: true
    capabilities?: true
    subscribes?: true
    publishes?: true
    callCount?: true
    successRate?: true
    createdAt?: true
    updatedAt?: true
    endpoint?: true
  }

  export type Agent_registrationsCountAggregateInputType = {
    id?: true
    name?: true
    type?: true
    category?: true
    description?: true
    version?: true
    config?: true
    inputSchema?: true
    outputSchema?: true
    capabilities?: true
    subscribes?: true
    publishes?: true
    callCount?: true
    successRate?: true
    createdAt?: true
    updatedAt?: true
    endpoint?: true
    _all?: true
  }

  export type Agent_registrationsAggregateArgs<ExtArgs extends $Extensions.InternalArgs = $Extensions.DefaultArgs> = {
    /**
     * Filter which agent_registrations to aggregate.
     */
    where?: agent_registrationsWhereInput
    /**
     * {@link https://www.prisma.io/docs/concepts/components/prisma-client/sorting Sorting Docs}
     * 
     * Determine the order of agent_registrations to fetch.
     */
    orderBy?: agent_registrationsOrderByWithRelationInput | agent_registrationsOrderByWithRelationInput[]
    /**
     * {@link https://www.prisma.io/docs/concepts/components/prisma-client/pagination#cursor-based-pagination Cursor Docs}
     * 
     * Sets the start position
     */
    cursor?: agent_registrationsWhereUniqueInput
    /**
     * {@link https://www.prisma.io/docs/concepts/components/prisma-client/pagination Pagination Docs}
     * 
     * Take `±n` agent_registrations from the position of the cursor.
     */
    take?: number
    /**
     * {@link https://www.prisma.io/docs/concepts/components/prisma-client/pagination Pagination Docs}
     * 
     * Skip the first `n` agent_registrations.
     */
    skip?: number
    /**
     * {@link https://www.prisma.io/docs/concepts/components/prisma-client/aggregations Aggregation Docs}
     * 
     * Count returned agent_registrations
    **/
    _count?: true | Agent_registrationsCountAggregateInputType
    /**
     * {@link https://www.prisma.io/docs/concepts/components/prisma-client/aggregations Aggregation Docs}
     * 
     * Select which fields to average
    **/
    _avg?: Agent_registrationsAvgAggregateInputType
    /**
     * {@link https://www.prisma.io/docs/concepts/components/prisma-client/aggregations Aggregation Docs}
     * 
     * Select which fields to sum
    **/
    _sum?: Agent_registrationsSumAggregateInputType
    /**
     * {@link https://www.prisma.io/docs/concepts/components/prisma-client/aggregations Aggregation Docs}
     * 
     * Select which fields to find the minimum value
    **/
    _min?: Agent_registrationsMinAggregateInputType
    /**
     * {@link https://www.prisma.io/docs/concepts/components/prisma-client/aggregations Aggregation Docs}
     * 
     * Select which fields to find the maximum value
    **/
    _max?: Agent_registrationsMaxAggregateInputType
  }

  export type GetAgent_registrationsAggregateType<T extends Agent_registrationsAggregateArgs> = {
        [P in keyof T & keyof AggregateAgent_registrations]: P extends '_count' | 'count'
      ? T[P] extends true
        ? number
        : GetScalarType<T[P], AggregateAgent_registrations[P]>
      : GetScalarType<T[P], AggregateAgent_registrations[P]>
  }




  export type agent_registrationsGroupByArgs<ExtArgs extends $Extensions.InternalArgs = $Extensions.DefaultArgs> = {
    where?: agent_registrationsWhereInput
    orderBy?: agent_registrationsOrderByWithAggregationInput | agent_registrationsOrderByWithAggregationInput[]
    by: Agent_registrationsScalarFieldEnum[] | Agent_registrationsScalarFieldEnum
    having?: agent_registrationsScalarWhereWithAggregatesInput
    take?: number
    skip?: number
    _count?: Agent_registrationsCountAggregateInputType | true
    _avg?: Agent_registrationsAvgAggregateInputType
    _sum?: Agent_registrationsSumAggregateInputType
    _min?: Agent_registrationsMinAggregateInputType
    _max?: Agent_registrationsMaxAggregateInputType
  }

  export type Agent_registrationsGroupByOutputType = {
    id: string
    name: string
    type: string
    category: string | null
    description: string | null
    version: string
    config: string | null
    inputSchema: string | null
    outputSchema: string | null
    capabilities: string | null
    subscribes: string | null
    publishes: string | null
    callCount: number
    successRate: number
    createdAt: Date
    updatedAt: Date
    endpoint: string | null
    _count: Agent_registrationsCountAggregateOutputType | null
    _avg: Agent_registrationsAvgAggregateOutputType | null
    _sum: Agent_registrationsSumAggregateOutputType | null
    _min: Agent_registrationsMinAggregateOutputType | null
    _max: Agent_registrationsMaxAggregateOutputType | null
  }

  type GetAgent_registrationsGroupByPayload<T extends agent_registrationsGroupByArgs> = Prisma.PrismaPromise<
    Array<
      PickEnumerable<Agent_registrationsGroupByOutputType, T['by']> &
        {
          [P in ((keyof T) & (keyof Agent_registrationsGroupByOutputType))]: P extends '_count'
            ? T[P] extends boolean
              ? number
              : GetScalarType<T[P], Agent_registrationsGroupByOutputType[P]>
            : GetScalarType<T[P], Agent_registrationsGroupByOutputType[P]>
        }
      >
    >


  export type agent_registrationsSelect<ExtArgs extends $Extensions.InternalArgs = $Extensions.DefaultArgs> = $Extensions.GetSelect<{
    id?: boolean
    name?: boolean
    type?: boolean
    category?: boolean
    description?: boolean
    version?: boolean
    config?: boolean
    inputSchema?: boolean
    outputSchema?: boolean
    capabilities?: boolean
    subscribes?: boolean
    publishes?: boolean
    callCount?: boolean
    successRate?: boolean
    createdAt?: boolean
    updatedAt?: boolean
    endpoint?: boolean
  }, ExtArgs["result"]["agent_registrations"]>

  export type agent_registrationsSelectCreateManyAndReturn<ExtArgs extends $Extensions.InternalArgs = $Extensions.DefaultArgs> = $Extensions.GetSelect<{
    id?: boolean
    name?: boolean
    type?: boolean
    category?: boolean
    description?: boolean
    version?: boolean
    config?: boolean
    inputSchema?: boolean
    outputSchema?: boolean
    capabilities?: boolean
    subscribes?: boolean
    publishes?: boolean
    callCount?: boolean
    successRate?: boolean
    createdAt?: boolean
    updatedAt?: boolean
    endpoint?: boolean
  }, ExtArgs["result"]["agent_registrations"]>

  export type agent_registrationsSelectScalar = {
    id?: boolean
    name?: boolean
    type?: boolean
    category?: boolean
    description?: boolean
    version?: boolean
    config?: boolean
    inputSchema?: boolean
    outputSchema?: boolean
    capabilities?: boolean
    subscribes?: boolean
    publishes?: boolean
    callCount?: boolean
    successRate?: boolean
    createdAt?: boolean
    updatedAt?: boolean
    endpoint?: boolean
  }


  export type $agent_registrationsPayload<ExtArgs extends $Extensions.InternalArgs = $Extensions.DefaultArgs> = {
    name: "agent_registrations"
    objects: {}
    scalars: $Extensions.GetPayloadResult<{
      id: string
      name: string
      type: string
      category: string | null
      description: string | null
      version: string
      config: string | null
      inputSchema: string | null
      outputSchema: string | null
      capabilities: string | null
      subscribes: string | null
      publishes: string | null
      callCount: number
      successRate: number
      createdAt: Date
      updatedAt: Date
      endpoint: string | null
    }, ExtArgs["result"]["agent_registrations"]>
    composites: {}
  }

  type agent_registrationsGetPayload<S extends boolean | null | undefined | agent_registrationsDefaultArgs> = $Result.GetResult<Prisma.$agent_registrationsPayload, S>

  type agent_registrationsCountArgs<ExtArgs extends $Extensions.InternalArgs = $Extensions.DefaultArgs> = 
    Omit<agent_registrationsFindManyArgs, 'select' | 'include' | 'distinct'> & {
      select?: Agent_registrationsCountAggregateInputType | true
    }

  export interface agent_registrationsDelegate<ExtArgs extends $Extensions.InternalArgs = $Extensions.DefaultArgs> {
    [K: symbol]: { types: Prisma.TypeMap<ExtArgs>['model']['agent_registrations'], meta: { name: 'agent_registrations' } }
    /**
     * Find zero or one Agent_registrations that matches the filter.
     * @param {agent_registrationsFindUniqueArgs} args - Arguments to find a Agent_registrations
     * @example
     * // Get one Agent_registrations
     * const agent_registrations = await prisma.agent_registrations.findUnique({
     *   where: {
     *     // ... provide filter here
     *   }
     * })
     */
    findUnique<T extends agent_registrationsFindUniqueArgs>(args: SelectSubset<T, agent_registrationsFindUniqueArgs<ExtArgs>>): Prisma__agent_registrationsClient<$Result.GetResult<Prisma.$agent_registrationsPayload<ExtArgs>, T, "findUnique"> | null, null, ExtArgs>

    /**
     * Find one Agent_registrations that matches the filter or throw an error with `error.code='P2025'` 
     * if no matches were found.
     * @param {agent_registrationsFindUniqueOrThrowArgs} args - Arguments to find a Agent_registrations
     * @example
     * // Get one Agent_registrations
     * const agent_registrations = await prisma.agent_registrations.findUniqueOrThrow({
     *   where: {
     *     // ... provide filter here
     *   }
     * })
     */
    findUniqueOrThrow<T extends agent_registrationsFindUniqueOrThrowArgs>(args: SelectSubset<T, agent_registrationsFindUniqueOrThrowArgs<ExtArgs>>): Prisma__agent_registrationsClient<$Result.GetResult<Prisma.$agent_registrationsPayload<ExtArgs>, T, "findUniqueOrThrow">, never, ExtArgs>

    /**
     * Find the first Agent_registrations that matches the filter.
     * Note, that providing `undefined` is treated as the value not being there.
     * Read more here: https://pris.ly/d/null-undefined
     * @param {agent_registrationsFindFirstArgs} args - Arguments to find a Agent_registrations
     * @example
     * // Get one Agent_registrations
     * const agent_registrations = await prisma.agent_registrations.findFirst({
     *   where: {
     *     // ... provide filter here
     *   }
     * })
     */
    findFirst<T extends agent_registrationsFindFirstArgs>(args?: SelectSubset<T, agent_registrationsFindFirstArgs<ExtArgs>>): Prisma__agent_registrationsClient<$Result.GetResult<Prisma.$agent_registrationsPayload<ExtArgs>, T, "findFirst"> | null, null, ExtArgs>

    /**
     * Find the first Agent_registrations that matches the filter or
     * throw `PrismaKnownClientError` with `P2025` code if no matches were found.
     * Note, that providing `undefined` is treated as the value not being there.
     * Read more here: https://pris.ly/d/null-undefined
     * @param {agent_registrationsFindFirstOrThrowArgs} args - Arguments to find a Agent_registrations
     * @example
     * // Get one Agent_registrations
     * const agent_registrations = await prisma.agent_registrations.findFirstOrThrow({
     *   where: {
     *     // ... provide filter here
     *   }
     * })
     */
    findFirstOrThrow<T extends agent_registrationsFindFirstOrThrowArgs>(args?: SelectSubset<T, agent_registrationsFindFirstOrThrowArgs<ExtArgs>>): Prisma__agent_registrationsClient<$Result.GetResult<Prisma.$agent_registrationsPayload<ExtArgs>, T, "findFirstOrThrow">, never, ExtArgs>

    /**
     * Find zero or more Agent_registrations that matches the filter.
     * Note, that providing `undefined` is treated as the value not being there.
     * Read more here: https://pris.ly/d/null-undefined
     * @param {agent_registrationsFindManyArgs} args - Arguments to filter and select certain fields only.
     * @example
     * // Get all Agent_registrations
     * const agent_registrations = await prisma.agent_registrations.findMany()
     * 
     * // Get first 10 Agent_registrations
     * const agent_registrations = await prisma.agent_registrations.findMany({ take: 10 })
     * 
     * // Only select the `id`
     * const agent_registrationsWithIdOnly = await prisma.agent_registrations.findMany({ select: { id: true } })
     * 
     */
    findMany<T extends agent_registrationsFindManyArgs>(args?: SelectSubset<T, agent_registrationsFindManyArgs<ExtArgs>>): Prisma.PrismaPromise<$Result.GetResult<Prisma.$agent_registrationsPayload<ExtArgs>, T, "findMany">>

    /**
     * Create a Agent_registrations.
     * @param {agent_registrationsCreateArgs} args - Arguments to create a Agent_registrations.
     * @example
     * // Create one Agent_registrations
     * const Agent_registrations = await prisma.agent_registrations.create({
     *   data: {
     *     // ... data to create a Agent_registrations
     *   }
     * })
     * 
     */
    create<T extends agent_registrationsCreateArgs>(args: SelectSubset<T, agent_registrationsCreateArgs<ExtArgs>>): Prisma__agent_registrationsClient<$Result.GetResult<Prisma.$agent_registrationsPayload<ExtArgs>, T, "create">, never, ExtArgs>

    /**
     * Create many Agent_registrations.
     * @param {agent_registrationsCreateManyArgs} args - Arguments to create many Agent_registrations.
     * @example
     * // Create many Agent_registrations
     * const agent_registrations = await prisma.agent_registrations.createMany({
     *   data: [
     *     // ... provide data here
     *   ]
     * })
     *     
     */
    createMany<T extends agent_registrationsCreateManyArgs>(args?: SelectSubset<T, agent_registrationsCreateManyArgs<ExtArgs>>): Prisma.PrismaPromise<BatchPayload>

    /**
     * Create many Agent_registrations and returns the data saved in the database.
     * @param {agent_registrationsCreateManyAndReturnArgs} args - Arguments to create many Agent_registrations.
     * @example
     * // Create many Agent_registrations
     * const agent_registrations = await prisma.agent_registrations.createManyAndReturn({
     *   data: [
     *     // ... provide data here
     *   ]
     * })
     * 
     * // Create many Agent_registrations and only return the `id`
     * const agent_registrationsWithIdOnly = await prisma.agent_registrations.createManyAndReturn({ 
     *   select: { id: true },
     *   data: [
     *     // ... provide data here
     *   ]
     * })
     * Note, that providing `undefined` is treated as the value not being there.
     * Read more here: https://pris.ly/d/null-undefined
     * 
     */
    createManyAndReturn<T extends agent_registrationsCreateManyAndReturnArgs>(args?: SelectSubset<T, agent_registrationsCreateManyAndReturnArgs<ExtArgs>>): Prisma.PrismaPromise<$Result.GetResult<Prisma.$agent_registrationsPayload<ExtArgs>, T, "createManyAndReturn">>

    /**
     * Delete a Agent_registrations.
     * @param {agent_registrationsDeleteArgs} args - Arguments to delete one Agent_registrations.
     * @example
     * // Delete one Agent_registrations
     * const Agent_registrations = await prisma.agent_registrations.delete({
     *   where: {
     *     // ... filter to delete one Agent_registrations
     *   }
     * })
     * 
     */
    delete<T extends agent_registrationsDeleteArgs>(args: SelectSubset<T, agent_registrationsDeleteArgs<ExtArgs>>): Prisma__agent_registrationsClient<$Result.GetResult<Prisma.$agent_registrationsPayload<ExtArgs>, T, "delete">, never, ExtArgs>

    /**
     * Update one Agent_registrations.
     * @param {agent_registrationsUpdateArgs} args - Arguments to update one Agent_registrations.
     * @example
     * // Update one Agent_registrations
     * const agent_registrations = await prisma.agent_registrations.update({
     *   where: {
     *     // ... provide filter here
     *   },
     *   data: {
     *     // ... provide data here
     *   }
     * })
     * 
     */
    update<T extends agent_registrationsUpdateArgs>(args: SelectSubset<T, agent_registrationsUpdateArgs<ExtArgs>>): Prisma__agent_registrationsClient<$Result.GetResult<Prisma.$agent_registrationsPayload<ExtArgs>, T, "update">, never, ExtArgs>

    /**
     * Delete zero or more Agent_registrations.
     * @param {agent_registrationsDeleteManyArgs} args - Arguments to filter Agent_registrations to delete.
     * @example
     * // Delete a few Agent_registrations
     * const { count } = await prisma.agent_registrations.deleteMany({
     *   where: {
     *     // ... provide filter here
     *   }
     * })
     * 
     */
    deleteMany<T extends agent_registrationsDeleteManyArgs>(args?: SelectSubset<T, agent_registrationsDeleteManyArgs<ExtArgs>>): Prisma.PrismaPromise<BatchPayload>

    /**
     * Update zero or more Agent_registrations.
     * Note, that providing `undefined` is treated as the value not being there.
     * Read more here: https://pris.ly/d/null-undefined
     * @param {agent_registrationsUpdateManyArgs} args - Arguments to update one or more rows.
     * @example
     * // Update many Agent_registrations
     * const agent_registrations = await prisma.agent_registrations.updateMany({
     *   where: {
     *     // ... provide filter here
     *   },
     *   data: {
     *     // ... provide data here
     *   }
     * })
     * 
     */
    updateMany<T extends agent_registrationsUpdateManyArgs>(args: SelectSubset<T, agent_registrationsUpdateManyArgs<ExtArgs>>): Prisma.PrismaPromise<BatchPayload>

    /**
     * Create or update one Agent_registrations.
     * @param {agent_registrationsUpsertArgs} args - Arguments to update or create a Agent_registrations.
     * @example
     * // Update or create a Agent_registrations
     * const agent_registrations = await prisma.agent_registrations.upsert({
     *   create: {
     *     // ... data to create a Agent_registrations
     *   },
     *   update: {
     *     // ... in case it already exists, update
     *   },
     *   where: {
     *     // ... the filter for the Agent_registrations we want to update
     *   }
     * })
     */
    upsert<T extends agent_registrationsUpsertArgs>(args: SelectSubset<T, agent_registrationsUpsertArgs<ExtArgs>>): Prisma__agent_registrationsClient<$Result.GetResult<Prisma.$agent_registrationsPayload<ExtArgs>, T, "upsert">, never, ExtArgs>


    /**
     * Count the number of Agent_registrations.
     * Note, that providing `undefined` is treated as the value not being there.
     * Read more here: https://pris.ly/d/null-undefined
     * @param {agent_registrationsCountArgs} args - Arguments to filter Agent_registrations to count.
     * @example
     * // Count the number of Agent_registrations
     * const count = await prisma.agent_registrations.count({
     *   where: {
     *     // ... the filter for the Agent_registrations we want to count
     *   }
     * })
    **/
    count<T extends agent_registrationsCountArgs>(
      args?: Subset<T, agent_registrationsCountArgs>,
    ): Prisma.PrismaPromise<
      T extends $Utils.Record<'select', any>
        ? T['select'] extends true
          ? number
          : GetScalarType<T['select'], Agent_registrationsCountAggregateOutputType>
        : number
    >

    /**
     * Allows you to perform aggregations operations on a Agent_registrations.
     * Note, that providing `undefined` is treated as the value not being there.
     * Read more here: https://pris.ly/d/null-undefined
     * @param {Agent_registrationsAggregateArgs} args - Select which aggregations you would like to apply and on what fields.
     * @example
     * // Ordered by age ascending
     * // Where email contains prisma.io
     * // Limited to the 10 users
     * const aggregations = await prisma.user.aggregate({
     *   _avg: {
     *     age: true,
     *   },
     *   where: {
     *     email: {
     *       contains: "prisma.io",
     *     },
     *   },
     *   orderBy: {
     *     age: "asc",
     *   },
     *   take: 10,
     * })
    **/
    aggregate<T extends Agent_registrationsAggregateArgs>(args: Subset<T, Agent_registrationsAggregateArgs>): Prisma.PrismaPromise<GetAgent_registrationsAggregateType<T>>

    /**
     * Group by Agent_registrations.
     * Note, that providing `undefined` is treated as the value not being there.
     * Read more here: https://pris.ly/d/null-undefined
     * @param {agent_registrationsGroupByArgs} args - Group by arguments.
     * @example
     * // Group by city, order by createdAt, get count
     * const result = await prisma.user.groupBy({
     *   by: ['city', 'createdAt'],
     *   orderBy: {
     *     createdAt: true
     *   },
     *   _count: {
     *     _all: true
     *   },
     * })
     * 
    **/
    groupBy<
      T extends agent_registrationsGroupByArgs,
      HasSelectOrTake extends Or<
        Extends<'skip', Keys<T>>,
        Extends<'take', Keys<T>>
      >,
      OrderByArg extends True extends HasSelectOrTake
        ? { orderBy: agent_registrationsGroupByArgs['orderBy'] }
        : { orderBy?: agent_registrationsGroupByArgs['orderBy'] },
      OrderFields extends ExcludeUnderscoreKeys<Keys<MaybeTupleToUnion<T['orderBy']>>>,
      ByFields extends MaybeTupleToUnion<T['by']>,
      ByValid extends Has<ByFields, OrderFields>,
      HavingFields extends GetHavingFields<T['having']>,
      HavingValid extends Has<ByFields, HavingFields>,
      ByEmpty extends T['by'] extends never[] ? True : False,
      InputErrors extends ByEmpty extends True
      ? `Error: "by" must not be empty.`
      : HavingValid extends False
      ? {
          [P in HavingFields]: P extends ByFields
            ? never
            : P extends string
            ? `Error: Field "${P}" used in "having" needs to be provided in "by".`
            : [
                Error,
                'Field ',
                P,
                ` in "having" needs to be provided in "by"`,
              ]
        }[HavingFields]
      : 'take' extends Keys<T>
      ? 'orderBy' extends Keys<T>
        ? ByValid extends True
          ? {}
          : {
              [P in OrderFields]: P extends ByFields
                ? never
                : `Error: Field "${P}" in "orderBy" needs to be provided in "by"`
            }[OrderFields]
        : 'Error: If you provide "take", you also need to provide "orderBy"'
      : 'skip' extends Keys<T>
      ? 'orderBy' extends Keys<T>
        ? ByValid extends True
          ? {}
          : {
              [P in OrderFields]: P extends ByFields
                ? never
                : `Error: Field "${P}" in "orderBy" needs to be provided in "by"`
            }[OrderFields]
        : 'Error: If you provide "skip", you also need to provide "orderBy"'
      : ByValid extends True
      ? {}
      : {
          [P in OrderFields]: P extends ByFields
            ? never
            : `Error: Field "${P}" in "orderBy" needs to be provided in "by"`
        }[OrderFields]
    >(args: SubsetIntersection<T, agent_registrationsGroupByArgs, OrderByArg> & InputErrors): {} extends InputErrors ? GetAgent_registrationsGroupByPayload<T> : Prisma.PrismaPromise<InputErrors>
  /**
   * Fields of the agent_registrations model
   */
  readonly fields: agent_registrationsFieldRefs;
  }

  /**
   * The delegate class that acts as a "Promise-like" for agent_registrations.
   * Why is this prefixed with `Prisma__`?
   * Because we want to prevent naming conflicts as mentioned in
   * https://github.com/prisma/prisma-client-js/issues/707
   */
  export interface Prisma__agent_registrationsClient<T, Null = never, ExtArgs extends $Extensions.InternalArgs = $Extensions.DefaultArgs> extends Prisma.PrismaPromise<T> {
    readonly [Symbol.toStringTag]: "PrismaPromise"
    /**
     * Attaches callbacks for the resolution and/or rejection of the Promise.
     * @param onfulfilled The callback to execute when the Promise is resolved.
     * @param onrejected The callback to execute when the Promise is rejected.
     * @returns A Promise for the completion of which ever callback is executed.
     */
    then<TResult1 = T, TResult2 = never>(onfulfilled?: ((value: T) => TResult1 | PromiseLike<TResult1>) | undefined | null, onrejected?: ((reason: any) => TResult2 | PromiseLike<TResult2>) | undefined | null): $Utils.JsPromise<TResult1 | TResult2>
    /**
     * Attaches a callback for only the rejection of the Promise.
     * @param onrejected The callback to execute when the Promise is rejected.
     * @returns A Promise for the completion of the callback.
     */
    catch<TResult = never>(onrejected?: ((reason: any) => TResult | PromiseLike<TResult>) | undefined | null): $Utils.JsPromise<T | TResult>
    /**
     * Attaches a callback that is invoked when the Promise is settled (fulfilled or rejected). The
     * resolved value cannot be modified from the callback.
     * @param onfinally The callback to execute when the Promise is settled (fulfilled or rejected).
     * @returns A Promise for the completion of the callback.
     */
    finally(onfinally?: (() => void) | undefined | null): $Utils.JsPromise<T>
  }




  /**
   * Fields of the agent_registrations model
   */ 
  interface agent_registrationsFieldRefs {
    readonly id: FieldRef<"agent_registrations", 'String'>
    readonly name: FieldRef<"agent_registrations", 'String'>
    readonly type: FieldRef<"agent_registrations", 'String'>
    readonly category: FieldRef<"agent_registrations", 'String'>
    readonly description: FieldRef<"agent_registrations", 'String'>
    readonly version: FieldRef<"agent_registrations", 'String'>
    readonly config: FieldRef<"agent_registrations", 'String'>
    readonly inputSchema: FieldRef<"agent_registrations", 'String'>
    readonly outputSchema: FieldRef<"agent_registrations", 'String'>
    readonly capabilities: FieldRef<"agent_registrations", 'String'>
    readonly subscribes: FieldRef<"agent_registrations", 'String'>
    readonly publishes: FieldRef<"agent_registrations", 'String'>
    readonly callCount: FieldRef<"agent_registrations", 'Int'>
    readonly successRate: FieldRef<"agent_registrations", 'Float'>
    readonly createdAt: FieldRef<"agent_registrations", 'DateTime'>
    readonly updatedAt: FieldRef<"agent_registrations", 'DateTime'>
    readonly endpoint: FieldRef<"agent_registrations", 'String'>
  }
    

  // Custom InputTypes
  /**
   * agent_registrations findUnique
   */
  export type agent_registrationsFindUniqueArgs<ExtArgs extends $Extensions.InternalArgs = $Extensions.DefaultArgs> = {
    /**
     * Select specific fields to fetch from the agent_registrations
     */
    select?: agent_registrationsSelect<ExtArgs> | null
    /**
     * Filter, which agent_registrations to fetch.
     */
    where: agent_registrationsWhereUniqueInput
  }

  /**
   * agent_registrations findUniqueOrThrow
   */
  export type agent_registrationsFindUniqueOrThrowArgs<ExtArgs extends $Extensions.InternalArgs = $Extensions.DefaultArgs> = {
    /**
     * Select specific fields to fetch from the agent_registrations
     */
    select?: agent_registrationsSelect<ExtArgs> | null
    /**
     * Filter, which agent_registrations to fetch.
     */
    where: agent_registrationsWhereUniqueInput
  }

  /**
   * agent_registrations findFirst
   */
  export type agent_registrationsFindFirstArgs<ExtArgs extends $Extensions.InternalArgs = $Extensions.DefaultArgs> = {
    /**
     * Select specific fields to fetch from the agent_registrations
     */
    select?: agent_registrationsSelect<ExtArgs> | null
    /**
     * Filter, which agent_registrations to fetch.
     */
    where?: agent_registrationsWhereInput
    /**
     * {@link https://www.prisma.io/docs/concepts/components/prisma-client/sorting Sorting Docs}
     * 
     * Determine the order of agent_registrations to fetch.
     */
    orderBy?: agent_registrationsOrderByWithRelationInput | agent_registrationsOrderByWithRelationInput[]
    /**
     * {@link https://www.prisma.io/docs/concepts/components/prisma-client/pagination#cursor-based-pagination Cursor Docs}
     * 
     * Sets the position for searching for agent_registrations.
     */
    cursor?: agent_registrationsWhereUniqueInput
    /**
     * {@link https://www.prisma.io/docs/concepts/components/prisma-client/pagination Pagination Docs}
     * 
     * Take `±n` agent_registrations from the position of the cursor.
     */
    take?: number
    /**
     * {@link https://www.prisma.io/docs/concepts/components/prisma-client/pagination Pagination Docs}
     * 
     * Skip the first `n` agent_registrations.
     */
    skip?: number
    /**
     * {@link https://www.prisma.io/docs/concepts/components/prisma-client/distinct Distinct Docs}
     * 
     * Filter by unique combinations of agent_registrations.
     */
    distinct?: Agent_registrationsScalarFieldEnum | Agent_registrationsScalarFieldEnum[]
  }

  /**
   * agent_registrations findFirstOrThrow
   */
  export type agent_registrationsFindFirstOrThrowArgs<ExtArgs extends $Extensions.InternalArgs = $Extensions.DefaultArgs> = {
    /**
     * Select specific fields to fetch from the agent_registrations
     */
    select?: agent_registrationsSelect<ExtArgs> | null
    /**
     * Filter, which agent_registrations to fetch.
     */
    where?: agent_registrationsWhereInput
    /**
     * {@link https://www.prisma.io/docs/concepts/components/prisma-client/sorting Sorting Docs}
     * 
     * Determine the order of agent_registrations to fetch.
     */
    orderBy?: agent_registrationsOrderByWithRelationInput | agent_registrationsOrderByWithRelationInput[]
    /**
     * {@link https://www.prisma.io/docs/concepts/components/prisma-client/pagination#cursor-based-pagination Cursor Docs}
     * 
     * Sets the position for searching for agent_registrations.
     */
    cursor?: agent_registrationsWhereUniqueInput
    /**
     * {@link https://www.prisma.io/docs/concepts/components/prisma-client/pagination Pagination Docs}
     * 
     * Take `±n` agent_registrations from the position of the cursor.
     */
    take?: number
    /**
     * {@link https://www.prisma.io/docs/concepts/components/prisma-client/pagination Pagination Docs}
     * 
     * Skip the first `n` agent_registrations.
     */
    skip?: number
    /**
     * {@link https://www.prisma.io/docs/concepts/components/prisma-client/distinct Distinct Docs}
     * 
     * Filter by unique combinations of agent_registrations.
     */
    distinct?: Agent_registrationsScalarFieldEnum | Agent_registrationsScalarFieldEnum[]
  }

  /**
   * agent_registrations findMany
   */
  export type agent_registrationsFindManyArgs<ExtArgs extends $Extensions.InternalArgs = $Extensions.DefaultArgs> = {
    /**
     * Select specific fields to fetch from the agent_registrations
     */
    select?: agent_registrationsSelect<ExtArgs> | null
    /**
     * Filter, which agent_registrations to fetch.
     */
    where?: agent_registrationsWhereInput
    /**
     * {@link https://www.prisma.io/docs/concepts/components/prisma-client/sorting Sorting Docs}
     * 
     * Determine the order of agent_registrations to fetch.
     */
    orderBy?: agent_registrationsOrderByWithRelationInput | agent_registrationsOrderByWithRelationInput[]
    /**
     * {@link https://www.prisma.io/docs/concepts/components/prisma-client/pagination#cursor-based-pagination Cursor Docs}
     * 
     * Sets the position for listing agent_registrations.
     */
    cursor?: agent_registrationsWhereUniqueInput
    /**
     * {@link https://www.prisma.io/docs/concepts/components/prisma-client/pagination Pagination Docs}
     * 
     * Take `±n` agent_registrations from the position of the cursor.
     */
    take?: number
    /**
     * {@link https://www.prisma.io/docs/concepts/components/prisma-client/pagination Pagination Docs}
     * 
     * Skip the first `n` agent_registrations.
     */
    skip?: number
    distinct?: Agent_registrationsScalarFieldEnum | Agent_registrationsScalarFieldEnum[]
  }

  /**
   * agent_registrations create
   */
  export type agent_registrationsCreateArgs<ExtArgs extends $Extensions.InternalArgs = $Extensions.DefaultArgs> = {
    /**
     * Select specific fields to fetch from the agent_registrations
     */
    select?: agent_registrationsSelect<ExtArgs> | null
    /**
     * The data needed to create a agent_registrations.
     */
    data: XOR<agent_registrationsCreateInput, agent_registrationsUncheckedCreateInput>
  }

  /**
   * agent_registrations createMany
   */
  export type agent_registrationsCreateManyArgs<ExtArgs extends $Extensions.InternalArgs = $Extensions.DefaultArgs> = {
    /**
     * The data used to create many agent_registrations.
     */
    data: agent_registrationsCreateManyInput | agent_registrationsCreateManyInput[]
  }

  /**
   * agent_registrations createManyAndReturn
   */
  export type agent_registrationsCreateManyAndReturnArgs<ExtArgs extends $Extensions.InternalArgs = $Extensions.DefaultArgs> = {
    /**
     * Select specific fields to fetch from the agent_registrations
     */
    select?: agent_registrationsSelectCreateManyAndReturn<ExtArgs> | null
    /**
     * The data used to create many agent_registrations.
     */
    data: agent_registrationsCreateManyInput | agent_registrationsCreateManyInput[]
  }

  /**
   * agent_registrations update
   */
  export type agent_registrationsUpdateArgs<ExtArgs extends $Extensions.InternalArgs = $Extensions.DefaultArgs> = {
    /**
     * Select specific fields to fetch from the agent_registrations
     */
    select?: agent_registrationsSelect<ExtArgs> | null
    /**
     * The data needed to update a agent_registrations.
     */
    data: XOR<agent_registrationsUpdateInput, agent_registrationsUncheckedUpdateInput>
    /**
     * Choose, which agent_registrations to update.
     */
    where: agent_registrationsWhereUniqueInput
  }

  /**
   * agent_registrations updateMany
   */
  export type agent_registrationsUpdateManyArgs<ExtArgs extends $Extensions.InternalArgs = $Extensions.DefaultArgs> = {
    /**
     * The data used to update agent_registrations.
     */
    data: XOR<agent_registrationsUpdateManyMutationInput, agent_registrationsUncheckedUpdateManyInput>
    /**
     * Filter which agent_registrations to update
     */
    where?: agent_registrationsWhereInput
  }

  /**
   * agent_registrations upsert
   */
  export type agent_registrationsUpsertArgs<ExtArgs extends $Extensions.InternalArgs = $Extensions.DefaultArgs> = {
    /**
     * Select specific fields to fetch from the agent_registrations
     */
    select?: agent_registrationsSelect<ExtArgs> | null
    /**
     * The filter to search for the agent_registrations to update in case it exists.
     */
    where: agent_registrationsWhereUniqueInput
    /**
     * In case the agent_registrations found by the `where` argument doesn't exist, create a new agent_registrations with this data.
     */
    create: XOR<agent_registrationsCreateInput, agent_registrationsUncheckedCreateInput>
    /**
     * In case the agent_registrations was found with the provided `where` argument, update it with this data.
     */
    update: XOR<agent_registrationsUpdateInput, agent_registrationsUncheckedUpdateInput>
  }

  /**
   * agent_registrations delete
   */
  export type agent_registrationsDeleteArgs<ExtArgs extends $Extensions.InternalArgs = $Extensions.DefaultArgs> = {
    /**
     * Select specific fields to fetch from the agent_registrations
     */
    select?: agent_registrationsSelect<ExtArgs> | null
    /**
     * Filter which agent_registrations to delete.
     */
    where: agent_registrationsWhereUniqueInput
  }

  /**
   * agent_registrations deleteMany
   */
  export type agent_registrationsDeleteManyArgs<ExtArgs extends $Extensions.InternalArgs = $Extensions.DefaultArgs> = {
    /**
     * Filter which agent_registrations to delete
     */
    where?: agent_registrationsWhereInput
  }

  /**
   * agent_registrations without action
   */
  export type agent_registrationsDefaultArgs<ExtArgs extends $Extensions.InternalArgs = $Extensions.DefaultArgs> = {
    /**
     * Select specific fields to fetch from the agent_registrations
     */
    select?: agent_registrationsSelect<ExtArgs> | null
  }


  /**
   * Model platform_api_configs
   */

  export type AggregatePlatform_api_configs = {
    _count: Platform_api_configsCountAggregateOutputType | null
    _avg: Platform_api_configsAvgAggregateOutputType | null
    _sum: Platform_api_configsSumAggregateOutputType | null
    _min: Platform_api_configsMinAggregateOutputType | null
    _max: Platform_api_configsMaxAggregateOutputType | null
  }

  export type Platform_api_configsAvgAggregateOutputType = {
    defaultTemperature: number | null
    defaultMaxTokens: number | null
  }

  export type Platform_api_configsSumAggregateOutputType = {
    defaultTemperature: number | null
    defaultMaxTokens: number | null
  }

  export type Platform_api_configsMinAggregateOutputType = {
    id: string | null
    apiUrl: string | null
    apiKey: string | null
    availableModels: string | null
    defaultModel: string | null
    defaultReasoningModel: string | null
    defaultEvaluationModel: string | null
    connectionStatus: string | null
    lastCheckedAt: Date | null
    createdAt: Date | null
    updatedAt: Date | null
    defaultTemperature: number | null
    defaultMaxTokens: number | null
    reasoningEndpoint: string | null
    lightEndpoint: string | null
    chatModels: string | null
    reasoningModels: string | null
    lightModels: string | null
    adminAccessMode: string | null
    adminAllowedIps: string | null
    allowPrivateNetwork: boolean | null
    privateNetworkHosts: string | null
  }

  export type Platform_api_configsMaxAggregateOutputType = {
    id: string | null
    apiUrl: string | null
    apiKey: string | null
    availableModels: string | null
    defaultModel: string | null
    defaultReasoningModel: string | null
    defaultEvaluationModel: string | null
    connectionStatus: string | null
    lastCheckedAt: Date | null
    createdAt: Date | null
    updatedAt: Date | null
    defaultTemperature: number | null
    defaultMaxTokens: number | null
    reasoningEndpoint: string | null
    lightEndpoint: string | null
    chatModels: string | null
    reasoningModels: string | null
    lightModels: string | null
    adminAccessMode: string | null
    adminAllowedIps: string | null
    allowPrivateNetwork: boolean | null
    privateNetworkHosts: string | null
  }

  export type Platform_api_configsCountAggregateOutputType = {
    id: number
    apiUrl: number
    apiKey: number
    availableModels: number
    defaultModel: number
    defaultReasoningModel: number
    defaultEvaluationModel: number
    connectionStatus: number
    lastCheckedAt: number
    createdAt: number
    updatedAt: number
    defaultTemperature: number
    defaultMaxTokens: number
    reasoningEndpoint: number
    lightEndpoint: number
    chatModels: number
    reasoningModels: number
    lightModels: number
    adminAccessMode: number
    adminAllowedIps: number
    allowPrivateNetwork: number
    privateNetworkHosts: number
    _all: number
  }


  export type Platform_api_configsAvgAggregateInputType = {
    defaultTemperature?: true
    defaultMaxTokens?: true
  }

  export type Platform_api_configsSumAggregateInputType = {
    defaultTemperature?: true
    defaultMaxTokens?: true
  }

  export type Platform_api_configsMinAggregateInputType = {
    id?: true
    apiUrl?: true
    apiKey?: true
    availableModels?: true
    defaultModel?: true
    defaultReasoningModel?: true
    defaultEvaluationModel?: true
    connectionStatus?: true
    lastCheckedAt?: true
    createdAt?: true
    updatedAt?: true
    defaultTemperature?: true
    defaultMaxTokens?: true
    reasoningEndpoint?: true
    lightEndpoint?: true
    chatModels?: true
    reasoningModels?: true
    lightModels?: true
    adminAccessMode?: true
    adminAllowedIps?: true
    allowPrivateNetwork?: true
    privateNetworkHosts?: true
  }

  export type Platform_api_configsMaxAggregateInputType = {
    id?: true
    apiUrl?: true
    apiKey?: true
    availableModels?: true
    defaultModel?: true
    defaultReasoningModel?: true
    defaultEvaluationModel?: true
    connectionStatus?: true
    lastCheckedAt?: true
    createdAt?: true
    updatedAt?: true
    defaultTemperature?: true
    defaultMaxTokens?: true
    reasoningEndpoint?: true
    lightEndpoint?: true
    chatModels?: true
    reasoningModels?: true
    lightModels?: true
    adminAccessMode?: true
    adminAllowedIps?: true
    allowPrivateNetwork?: true
    privateNetworkHosts?: true
  }

  export type Platform_api_configsCountAggregateInputType = {
    id?: true
    apiUrl?: true
    apiKey?: true
    availableModels?: true
    defaultModel?: true
    defaultReasoningModel?: true
    defaultEvaluationModel?: true
    connectionStatus?: true
    lastCheckedAt?: true
    createdAt?: true
    updatedAt?: true
    defaultTemperature?: true
    defaultMaxTokens?: true
    reasoningEndpoint?: true
    lightEndpoint?: true
    chatModels?: true
    reasoningModels?: true
    lightModels?: true
    adminAccessMode?: true
    adminAllowedIps?: true
    allowPrivateNetwork?: true
    privateNetworkHosts?: true
    _all?: true
  }

  export type Platform_api_configsAggregateArgs<ExtArgs extends $Extensions.InternalArgs = $Extensions.DefaultArgs> = {
    /**
     * Filter which platform_api_configs to aggregate.
     */
    where?: platform_api_configsWhereInput
    /**
     * {@link https://www.prisma.io/docs/concepts/components/prisma-client/sorting Sorting Docs}
     * 
     * Determine the order of platform_api_configs to fetch.
     */
    orderBy?: platform_api_configsOrderByWithRelationInput | platform_api_configsOrderByWithRelationInput[]
    /**
     * {@link https://www.prisma.io/docs/concepts/components/prisma-client/pagination#cursor-based-pagination Cursor Docs}
     * 
     * Sets the start position
     */
    cursor?: platform_api_configsWhereUniqueInput
    /**
     * {@link https://www.prisma.io/docs/concepts/components/prisma-client/pagination Pagination Docs}
     * 
     * Take `±n` platform_api_configs from the position of the cursor.
     */
    take?: number
    /**
     * {@link https://www.prisma.io/docs/concepts/components/prisma-client/pagination Pagination Docs}
     * 
     * Skip the first `n` platform_api_configs.
     */
    skip?: number
    /**
     * {@link https://www.prisma.io/docs/concepts/components/prisma-client/aggregations Aggregation Docs}
     * 
     * Count returned platform_api_configs
    **/
    _count?: true | Platform_api_configsCountAggregateInputType
    /**
     * {@link https://www.prisma.io/docs/concepts/components/prisma-client/aggregations Aggregation Docs}
     * 
     * Select which fields to average
    **/
    _avg?: Platform_api_configsAvgAggregateInputType
    /**
     * {@link https://www.prisma.io/docs/concepts/components/prisma-client/aggregations Aggregation Docs}
     * 
     * Select which fields to sum
    **/
    _sum?: Platform_api_configsSumAggregateInputType
    /**
     * {@link https://www.prisma.io/docs/concepts/components/prisma-client/aggregations Aggregation Docs}
     * 
     * Select which fields to find the minimum value
    **/
    _min?: Platform_api_configsMinAggregateInputType
    /**
     * {@link https://www.prisma.io/docs/concepts/components/prisma-client/aggregations Aggregation Docs}
     * 
     * Select which fields to find the maximum value
    **/
    _max?: Platform_api_configsMaxAggregateInputType
  }

  export type GetPlatform_api_configsAggregateType<T extends Platform_api_configsAggregateArgs> = {
        [P in keyof T & keyof AggregatePlatform_api_configs]: P extends '_count' | 'count'
      ? T[P] extends true
        ? number
        : GetScalarType<T[P], AggregatePlatform_api_configs[P]>
      : GetScalarType<T[P], AggregatePlatform_api_configs[P]>
  }




  export type platform_api_configsGroupByArgs<ExtArgs extends $Extensions.InternalArgs = $Extensions.DefaultArgs> = {
    where?: platform_api_configsWhereInput
    orderBy?: platform_api_configsOrderByWithAggregationInput | platform_api_configsOrderByWithAggregationInput[]
    by: Platform_api_configsScalarFieldEnum[] | Platform_api_configsScalarFieldEnum
    having?: platform_api_configsScalarWhereWithAggregatesInput
    take?: number
    skip?: number
    _count?: Platform_api_configsCountAggregateInputType | true
    _avg?: Platform_api_configsAvgAggregateInputType
    _sum?: Platform_api_configsSumAggregateInputType
    _min?: Platform_api_configsMinAggregateInputType
    _max?: Platform_api_configsMaxAggregateInputType
  }

  export type Platform_api_configsGroupByOutputType = {
    id: string
    apiUrl: string | null
    apiKey: string | null
    availableModels: string | null
    defaultModel: string | null
    defaultReasoningModel: string | null
    defaultEvaluationModel: string | null
    connectionStatus: string
    lastCheckedAt: Date | null
    createdAt: Date
    updatedAt: Date
    defaultTemperature: number
    defaultMaxTokens: number
    reasoningEndpoint: string | null
    lightEndpoint: string | null
    chatModels: string | null
    reasoningModels: string | null
    lightModels: string | null
    adminAccessMode: string | null
    adminAllowedIps: string | null
    allowPrivateNetwork: boolean | null
    privateNetworkHosts: string | null
    _count: Platform_api_configsCountAggregateOutputType | null
    _avg: Platform_api_configsAvgAggregateOutputType | null
    _sum: Platform_api_configsSumAggregateOutputType | null
    _min: Platform_api_configsMinAggregateOutputType | null
    _max: Platform_api_configsMaxAggregateOutputType | null
  }

  type GetPlatform_api_configsGroupByPayload<T extends platform_api_configsGroupByArgs> = Prisma.PrismaPromise<
    Array<
      PickEnumerable<Platform_api_configsGroupByOutputType, T['by']> &
        {
          [P in ((keyof T) & (keyof Platform_api_configsGroupByOutputType))]: P extends '_count'
            ? T[P] extends boolean
              ? number
              : GetScalarType<T[P], Platform_api_configsGroupByOutputType[P]>
            : GetScalarType<T[P], Platform_api_configsGroupByOutputType[P]>
        }
      >
    >


  export type platform_api_configsSelect<ExtArgs extends $Extensions.InternalArgs = $Extensions.DefaultArgs> = $Extensions.GetSelect<{
    id?: boolean
    apiUrl?: boolean
    apiKey?: boolean
    availableModels?: boolean
    defaultModel?: boolean
    defaultReasoningModel?: boolean
    defaultEvaluationModel?: boolean
    connectionStatus?: boolean
    lastCheckedAt?: boolean
    createdAt?: boolean
    updatedAt?: boolean
    defaultTemperature?: boolean
    defaultMaxTokens?: boolean
    reasoningEndpoint?: boolean
    lightEndpoint?: boolean
    chatModels?: boolean
    reasoningModels?: boolean
    lightModels?: boolean
    adminAccessMode?: boolean
    adminAllowedIps?: boolean
    allowPrivateNetwork?: boolean
    privateNetworkHosts?: boolean
  }, ExtArgs["result"]["platform_api_configs"]>

  export type platform_api_configsSelectCreateManyAndReturn<ExtArgs extends $Extensions.InternalArgs = $Extensions.DefaultArgs> = $Extensions.GetSelect<{
    id?: boolean
    apiUrl?: boolean
    apiKey?: boolean
    availableModels?: boolean
    defaultModel?: boolean
    defaultReasoningModel?: boolean
    defaultEvaluationModel?: boolean
    connectionStatus?: boolean
    lastCheckedAt?: boolean
    createdAt?: boolean
    updatedAt?: boolean
    defaultTemperature?: boolean
    defaultMaxTokens?: boolean
    reasoningEndpoint?: boolean
    lightEndpoint?: boolean
    chatModels?: boolean
    reasoningModels?: boolean
    lightModels?: boolean
    adminAccessMode?: boolean
    adminAllowedIps?: boolean
    allowPrivateNetwork?: boolean
    privateNetworkHosts?: boolean
  }, ExtArgs["result"]["platform_api_configs"]>

  export type platform_api_configsSelectScalar = {
    id?: boolean
    apiUrl?: boolean
    apiKey?: boolean
    availableModels?: boolean
    defaultModel?: boolean
    defaultReasoningModel?: boolean
    defaultEvaluationModel?: boolean
    connectionStatus?: boolean
    lastCheckedAt?: boolean
    createdAt?: boolean
    updatedAt?: boolean
    defaultTemperature?: boolean
    defaultMaxTokens?: boolean
    reasoningEndpoint?: boolean
    lightEndpoint?: boolean
    chatModels?: boolean
    reasoningModels?: boolean
    lightModels?: boolean
    adminAccessMode?: boolean
    adminAllowedIps?: boolean
    allowPrivateNetwork?: boolean
    privateNetworkHosts?: boolean
  }


  export type $platform_api_configsPayload<ExtArgs extends $Extensions.InternalArgs = $Extensions.DefaultArgs> = {
    name: "platform_api_configs"
    objects: {}
    scalars: $Extensions.GetPayloadResult<{
      id: string
      apiUrl: string | null
      apiKey: string | null
      availableModels: string | null
      defaultModel: string | null
      defaultReasoningModel: string | null
      defaultEvaluationModel: string | null
      connectionStatus: string
      lastCheckedAt: Date | null
      createdAt: Date
      updatedAt: Date
      defaultTemperature: number
      defaultMaxTokens: number
      reasoningEndpoint: string | null
      lightEndpoint: string | null
      chatModels: string | null
      reasoningModels: string | null
      lightModels: string | null
      adminAccessMode: string | null
      adminAllowedIps: string | null
      allowPrivateNetwork: boolean | null
      privateNetworkHosts: string | null
    }, ExtArgs["result"]["platform_api_configs"]>
    composites: {}
  }

  type platform_api_configsGetPayload<S extends boolean | null | undefined | platform_api_configsDefaultArgs> = $Result.GetResult<Prisma.$platform_api_configsPayload, S>

  type platform_api_configsCountArgs<ExtArgs extends $Extensions.InternalArgs = $Extensions.DefaultArgs> = 
    Omit<platform_api_configsFindManyArgs, 'select' | 'include' | 'distinct'> & {
      select?: Platform_api_configsCountAggregateInputType | true
    }

  export interface platform_api_configsDelegate<ExtArgs extends $Extensions.InternalArgs = $Extensions.DefaultArgs> {
    [K: symbol]: { types: Prisma.TypeMap<ExtArgs>['model']['platform_api_configs'], meta: { name: 'platform_api_configs' } }
    /**
     * Find zero or one Platform_api_configs that matches the filter.
     * @param {platform_api_configsFindUniqueArgs} args - Arguments to find a Platform_api_configs
     * @example
     * // Get one Platform_api_configs
     * const platform_api_configs = await prisma.platform_api_configs.findUnique({
     *   where: {
     *     // ... provide filter here
     *   }
     * })
     */
    findUnique<T extends platform_api_configsFindUniqueArgs>(args: SelectSubset<T, platform_api_configsFindUniqueArgs<ExtArgs>>): Prisma__platform_api_configsClient<$Result.GetResult<Prisma.$platform_api_configsPayload<ExtArgs>, T, "findUnique"> | null, null, ExtArgs>

    /**
     * Find one Platform_api_configs that matches the filter or throw an error with `error.code='P2025'` 
     * if no matches were found.
     * @param {platform_api_configsFindUniqueOrThrowArgs} args - Arguments to find a Platform_api_configs
     * @example
     * // Get one Platform_api_configs
     * const platform_api_configs = await prisma.platform_api_configs.findUniqueOrThrow({
     *   where: {
     *     // ... provide filter here
     *   }
     * })
     */
    findUniqueOrThrow<T extends platform_api_configsFindUniqueOrThrowArgs>(args: SelectSubset<T, platform_api_configsFindUniqueOrThrowArgs<ExtArgs>>): Prisma__platform_api_configsClient<$Result.GetResult<Prisma.$platform_api_configsPayload<ExtArgs>, T, "findUniqueOrThrow">, never, ExtArgs>

    /**
     * Find the first Platform_api_configs that matches the filter.
     * Note, that providing `undefined` is treated as the value not being there.
     * Read more here: https://pris.ly/d/null-undefined
     * @param {platform_api_configsFindFirstArgs} args - Arguments to find a Platform_api_configs
     * @example
     * // Get one Platform_api_configs
     * const platform_api_configs = await prisma.platform_api_configs.findFirst({
     *   where: {
     *     // ... provide filter here
     *   }
     * })
     */
    findFirst<T extends platform_api_configsFindFirstArgs>(args?: SelectSubset<T, platform_api_configsFindFirstArgs<ExtArgs>>): Prisma__platform_api_configsClient<$Result.GetResult<Prisma.$platform_api_configsPayload<ExtArgs>, T, "findFirst"> | null, null, ExtArgs>

    /**
     * Find the first Platform_api_configs that matches the filter or
     * throw `PrismaKnownClientError` with `P2025` code if no matches were found.
     * Note, that providing `undefined` is treated as the value not being there.
     * Read more here: https://pris.ly/d/null-undefined
     * @param {platform_api_configsFindFirstOrThrowArgs} args - Arguments to find a Platform_api_configs
     * @example
     * // Get one Platform_api_configs
     * const platform_api_configs = await prisma.platform_api_configs.findFirstOrThrow({
     *   where: {
     *     // ... provide filter here
     *   }
     * })
     */
    findFirstOrThrow<T extends platform_api_configsFindFirstOrThrowArgs>(args?: SelectSubset<T, platform_api_configsFindFirstOrThrowArgs<ExtArgs>>): Prisma__platform_api_configsClient<$Result.GetResult<Prisma.$platform_api_configsPayload<ExtArgs>, T, "findFirstOrThrow">, never, ExtArgs>

    /**
     * Find zero or more Platform_api_configs that matches the filter.
     * Note, that providing `undefined` is treated as the value not being there.
     * Read more here: https://pris.ly/d/null-undefined
     * @param {platform_api_configsFindManyArgs} args - Arguments to filter and select certain fields only.
     * @example
     * // Get all Platform_api_configs
     * const platform_api_configs = await prisma.platform_api_configs.findMany()
     * 
     * // Get first 10 Platform_api_configs
     * const platform_api_configs = await prisma.platform_api_configs.findMany({ take: 10 })
     * 
     * // Only select the `id`
     * const platform_api_configsWithIdOnly = await prisma.platform_api_configs.findMany({ select: { id: true } })
     * 
     */
    findMany<T extends platform_api_configsFindManyArgs>(args?: SelectSubset<T, platform_api_configsFindManyArgs<ExtArgs>>): Prisma.PrismaPromise<$Result.GetResult<Prisma.$platform_api_configsPayload<ExtArgs>, T, "findMany">>

    /**
     * Create a Platform_api_configs.
     * @param {platform_api_configsCreateArgs} args - Arguments to create a Platform_api_configs.
     * @example
     * // Create one Platform_api_configs
     * const Platform_api_configs = await prisma.platform_api_configs.create({
     *   data: {
     *     // ... data to create a Platform_api_configs
     *   }
     * })
     * 
     */
    create<T extends platform_api_configsCreateArgs>(args: SelectSubset<T, platform_api_configsCreateArgs<ExtArgs>>): Prisma__platform_api_configsClient<$Result.GetResult<Prisma.$platform_api_configsPayload<ExtArgs>, T, "create">, never, ExtArgs>

    /**
     * Create many Platform_api_configs.
     * @param {platform_api_configsCreateManyArgs} args - Arguments to create many Platform_api_configs.
     * @example
     * // Create many Platform_api_configs
     * const platform_api_configs = await prisma.platform_api_configs.createMany({
     *   data: [
     *     // ... provide data here
     *   ]
     * })
     *     
     */
    createMany<T extends platform_api_configsCreateManyArgs>(args?: SelectSubset<T, platform_api_configsCreateManyArgs<ExtArgs>>): Prisma.PrismaPromise<BatchPayload>

    /**
     * Create many Platform_api_configs and returns the data saved in the database.
     * @param {platform_api_configsCreateManyAndReturnArgs} args - Arguments to create many Platform_api_configs.
     * @example
     * // Create many Platform_api_configs
     * const platform_api_configs = await prisma.platform_api_configs.createManyAndReturn({
     *   data: [
     *     // ... provide data here
     *   ]
     * })
     * 
     * // Create many Platform_api_configs and only return the `id`
     * const platform_api_configsWithIdOnly = await prisma.platform_api_configs.createManyAndReturn({ 
     *   select: { id: true },
     *   data: [
     *     // ... provide data here
     *   ]
     * })
     * Note, that providing `undefined` is treated as the value not being there.
     * Read more here: https://pris.ly/d/null-undefined
     * 
     */
    createManyAndReturn<T extends platform_api_configsCreateManyAndReturnArgs>(args?: SelectSubset<T, platform_api_configsCreateManyAndReturnArgs<ExtArgs>>): Prisma.PrismaPromise<$Result.GetResult<Prisma.$platform_api_configsPayload<ExtArgs>, T, "createManyAndReturn">>

    /**
     * Delete a Platform_api_configs.
     * @param {platform_api_configsDeleteArgs} args - Arguments to delete one Platform_api_configs.
     * @example
     * // Delete one Platform_api_configs
     * const Platform_api_configs = await prisma.platform_api_configs.delete({
     *   where: {
     *     // ... filter to delete one Platform_api_configs
     *   }
     * })
     * 
     */
    delete<T extends platform_api_configsDeleteArgs>(args: SelectSubset<T, platform_api_configsDeleteArgs<ExtArgs>>): Prisma__platform_api_configsClient<$Result.GetResult<Prisma.$platform_api_configsPayload<ExtArgs>, T, "delete">, never, ExtArgs>

    /**
     * Update one Platform_api_configs.
     * @param {platform_api_configsUpdateArgs} args - Arguments to update one Platform_api_configs.
     * @example
     * // Update one Platform_api_configs
     * const platform_api_configs = await prisma.platform_api_configs.update({
     *   where: {
     *     // ... provide filter here
     *   },
     *   data: {
     *     // ... provide data here
     *   }
     * })
     * 
     */
    update<T extends platform_api_configsUpdateArgs>(args: SelectSubset<T, platform_api_configsUpdateArgs<ExtArgs>>): Prisma__platform_api_configsClient<$Result.GetResult<Prisma.$platform_api_configsPayload<ExtArgs>, T, "update">, never, ExtArgs>

    /**
     * Delete zero or more Platform_api_configs.
     * @param {platform_api_configsDeleteManyArgs} args - Arguments to filter Platform_api_configs to delete.
     * @example
     * // Delete a few Platform_api_configs
     * const { count } = await prisma.platform_api_configs.deleteMany({
     *   where: {
     *     // ... provide filter here
     *   }
     * })
     * 
     */
    deleteMany<T extends platform_api_configsDeleteManyArgs>(args?: SelectSubset<T, platform_api_configsDeleteManyArgs<ExtArgs>>): Prisma.PrismaPromise<BatchPayload>

    /**
     * Update zero or more Platform_api_configs.
     * Note, that providing `undefined` is treated as the value not being there.
     * Read more here: https://pris.ly/d/null-undefined
     * @param {platform_api_configsUpdateManyArgs} args - Arguments to update one or more rows.
     * @example
     * // Update many Platform_api_configs
     * const platform_api_configs = await prisma.platform_api_configs.updateMany({
     *   where: {
     *     // ... provide filter here
     *   },
     *   data: {
     *     // ... provide data here
     *   }
     * })
     * 
     */
    updateMany<T extends platform_api_configsUpdateManyArgs>(args: SelectSubset<T, platform_api_configsUpdateManyArgs<ExtArgs>>): Prisma.PrismaPromise<BatchPayload>

    /**
     * Create or update one Platform_api_configs.
     * @param {platform_api_configsUpsertArgs} args - Arguments to update or create a Platform_api_configs.
     * @example
     * // Update or create a Platform_api_configs
     * const platform_api_configs = await prisma.platform_api_configs.upsert({
     *   create: {
     *     // ... data to create a Platform_api_configs
     *   },
     *   update: {
     *     // ... in case it already exists, update
     *   },
     *   where: {
     *     // ... the filter for the Platform_api_configs we want to update
     *   }
     * })
     */
    upsert<T extends platform_api_configsUpsertArgs>(args: SelectSubset<T, platform_api_configsUpsertArgs<ExtArgs>>): Prisma__platform_api_configsClient<$Result.GetResult<Prisma.$platform_api_configsPayload<ExtArgs>, T, "upsert">, never, ExtArgs>


    /**
     * Count the number of Platform_api_configs.
     * Note, that providing `undefined` is treated as the value not being there.
     * Read more here: https://pris.ly/d/null-undefined
     * @param {platform_api_configsCountArgs} args - Arguments to filter Platform_api_configs to count.
     * @example
     * // Count the number of Platform_api_configs
     * const count = await prisma.platform_api_configs.count({
     *   where: {
     *     // ... the filter for the Platform_api_configs we want to count
     *   }
     * })
    **/
    count<T extends platform_api_configsCountArgs>(
      args?: Subset<T, platform_api_configsCountArgs>,
    ): Prisma.PrismaPromise<
      T extends $Utils.Record<'select', any>
        ? T['select'] extends true
          ? number
          : GetScalarType<T['select'], Platform_api_configsCountAggregateOutputType>
        : number
    >

    /**
     * Allows you to perform aggregations operations on a Platform_api_configs.
     * Note, that providing `undefined` is treated as the value not being there.
     * Read more here: https://pris.ly/d/null-undefined
     * @param {Platform_api_configsAggregateArgs} args - Select which aggregations you would like to apply and on what fields.
     * @example
     * // Ordered by age ascending
     * // Where email contains prisma.io
     * // Limited to the 10 users
     * const aggregations = await prisma.user.aggregate({
     *   _avg: {
     *     age: true,
     *   },
     *   where: {
     *     email: {
     *       contains: "prisma.io",
     *     },
     *   },
     *   orderBy: {
     *     age: "asc",
     *   },
     *   take: 10,
     * })
    **/
    aggregate<T extends Platform_api_configsAggregateArgs>(args: Subset<T, Platform_api_configsAggregateArgs>): Prisma.PrismaPromise<GetPlatform_api_configsAggregateType<T>>

    /**
     * Group by Platform_api_configs.
     * Note, that providing `undefined` is treated as the value not being there.
     * Read more here: https://pris.ly/d/null-undefined
     * @param {platform_api_configsGroupByArgs} args - Group by arguments.
     * @example
     * // Group by city, order by createdAt, get count
     * const result = await prisma.user.groupBy({
     *   by: ['city', 'createdAt'],
     *   orderBy: {
     *     createdAt: true
     *   },
     *   _count: {
     *     _all: true
     *   },
     * })
     * 
    **/
    groupBy<
      T extends platform_api_configsGroupByArgs,
      HasSelectOrTake extends Or<
        Extends<'skip', Keys<T>>,
        Extends<'take', Keys<T>>
      >,
      OrderByArg extends True extends HasSelectOrTake
        ? { orderBy: platform_api_configsGroupByArgs['orderBy'] }
        : { orderBy?: platform_api_configsGroupByArgs['orderBy'] },
      OrderFields extends ExcludeUnderscoreKeys<Keys<MaybeTupleToUnion<T['orderBy']>>>,
      ByFields extends MaybeTupleToUnion<T['by']>,
      ByValid extends Has<ByFields, OrderFields>,
      HavingFields extends GetHavingFields<T['having']>,
      HavingValid extends Has<ByFields, HavingFields>,
      ByEmpty extends T['by'] extends never[] ? True : False,
      InputErrors extends ByEmpty extends True
      ? `Error: "by" must not be empty.`
      : HavingValid extends False
      ? {
          [P in HavingFields]: P extends ByFields
            ? never
            : P extends string
            ? `Error: Field "${P}" used in "having" needs to be provided in "by".`
            : [
                Error,
                'Field ',
                P,
                ` in "having" needs to be provided in "by"`,
              ]
        }[HavingFields]
      : 'take' extends Keys<T>
      ? 'orderBy' extends Keys<T>
        ? ByValid extends True
          ? {}
          : {
              [P in OrderFields]: P extends ByFields
                ? never
                : `Error: Field "${P}" in "orderBy" needs to be provided in "by"`
            }[OrderFields]
        : 'Error: If you provide "take", you also need to provide "orderBy"'
      : 'skip' extends Keys<T>
      ? 'orderBy' extends Keys<T>
        ? ByValid extends True
          ? {}
          : {
              [P in OrderFields]: P extends ByFields
                ? never
                : `Error: Field "${P}" in "orderBy" needs to be provided in "by"`
            }[OrderFields]
        : 'Error: If you provide "skip", you also need to provide "orderBy"'
      : ByValid extends True
      ? {}
      : {
          [P in OrderFields]: P extends ByFields
            ? never
            : `Error: Field "${P}" in "orderBy" needs to be provided in "by"`
        }[OrderFields]
    >(args: SubsetIntersection<T, platform_api_configsGroupByArgs, OrderByArg> & InputErrors): {} extends InputErrors ? GetPlatform_api_configsGroupByPayload<T> : Prisma.PrismaPromise<InputErrors>
  /**
   * Fields of the platform_api_configs model
   */
  readonly fields: platform_api_configsFieldRefs;
  }

  /**
   * The delegate class that acts as a "Promise-like" for platform_api_configs.
   * Why is this prefixed with `Prisma__`?
   * Because we want to prevent naming conflicts as mentioned in
   * https://github.com/prisma/prisma-client-js/issues/707
   */
  export interface Prisma__platform_api_configsClient<T, Null = never, ExtArgs extends $Extensions.InternalArgs = $Extensions.DefaultArgs> extends Prisma.PrismaPromise<T> {
    readonly [Symbol.toStringTag]: "PrismaPromise"
    /**
     * Attaches callbacks for the resolution and/or rejection of the Promise.
     * @param onfulfilled The callback to execute when the Promise is resolved.
     * @param onrejected The callback to execute when the Promise is rejected.
     * @returns A Promise for the completion of which ever callback is executed.
     */
    then<TResult1 = T, TResult2 = never>(onfulfilled?: ((value: T) => TResult1 | PromiseLike<TResult1>) | undefined | null, onrejected?: ((reason: any) => TResult2 | PromiseLike<TResult2>) | undefined | null): $Utils.JsPromise<TResult1 | TResult2>
    /**
     * Attaches a callback for only the rejection of the Promise.
     * @param onrejected The callback to execute when the Promise is rejected.
     * @returns A Promise for the completion of the callback.
     */
    catch<TResult = never>(onrejected?: ((reason: any) => TResult | PromiseLike<TResult>) | undefined | null): $Utils.JsPromise<T | TResult>
    /**
     * Attaches a callback that is invoked when the Promise is settled (fulfilled or rejected). The
     * resolved value cannot be modified from the callback.
     * @param onfinally The callback to execute when the Promise is settled (fulfilled or rejected).
     * @returns A Promise for the completion of the callback.
     */
    finally(onfinally?: (() => void) | undefined | null): $Utils.JsPromise<T>
  }




  /**
   * Fields of the platform_api_configs model
   */ 
  interface platform_api_configsFieldRefs {
    readonly id: FieldRef<"platform_api_configs", 'String'>
    readonly apiUrl: FieldRef<"platform_api_configs", 'String'>
    readonly apiKey: FieldRef<"platform_api_configs", 'String'>
    readonly availableModels: FieldRef<"platform_api_configs", 'String'>
    readonly defaultModel: FieldRef<"platform_api_configs", 'String'>
    readonly defaultReasoningModel: FieldRef<"platform_api_configs", 'String'>
    readonly defaultEvaluationModel: FieldRef<"platform_api_configs", 'String'>
    readonly connectionStatus: FieldRef<"platform_api_configs", 'String'>
    readonly lastCheckedAt: FieldRef<"platform_api_configs", 'DateTime'>
    readonly createdAt: FieldRef<"platform_api_configs", 'DateTime'>
    readonly updatedAt: FieldRef<"platform_api_configs", 'DateTime'>
    readonly defaultTemperature: FieldRef<"platform_api_configs", 'Float'>
    readonly defaultMaxTokens: FieldRef<"platform_api_configs", 'Int'>
    readonly reasoningEndpoint: FieldRef<"platform_api_configs", 'String'>
    readonly lightEndpoint: FieldRef<"platform_api_configs", 'String'>
    readonly chatModels: FieldRef<"platform_api_configs", 'String'>
    readonly reasoningModels: FieldRef<"platform_api_configs", 'String'>
    readonly lightModels: FieldRef<"platform_api_configs", 'String'>
    readonly adminAccessMode: FieldRef<"platform_api_configs", 'String'>
    readonly adminAllowedIps: FieldRef<"platform_api_configs", 'String'>
    readonly allowPrivateNetwork: FieldRef<"platform_api_configs", 'Boolean'>
    readonly privateNetworkHosts: FieldRef<"platform_api_configs", 'String'>
  }
    

  // Custom InputTypes
  /**
   * platform_api_configs findUnique
   */
  export type platform_api_configsFindUniqueArgs<ExtArgs extends $Extensions.InternalArgs = $Extensions.DefaultArgs> = {
    /**
     * Select specific fields to fetch from the platform_api_configs
     */
    select?: platform_api_configsSelect<ExtArgs> | null
    /**
     * Filter, which platform_api_configs to fetch.
     */
    where: platform_api_configsWhereUniqueInput
  }

  /**
   * platform_api_configs findUniqueOrThrow
   */
  export type platform_api_configsFindUniqueOrThrowArgs<ExtArgs extends $Extensions.InternalArgs = $Extensions.DefaultArgs> = {
    /**
     * Select specific fields to fetch from the platform_api_configs
     */
    select?: platform_api_configsSelect<ExtArgs> | null
    /**
     * Filter, which platform_api_configs to fetch.
     */
    where: platform_api_configsWhereUniqueInput
  }

  /**
   * platform_api_configs findFirst
   */
  export type platform_api_configsFindFirstArgs<ExtArgs extends $Extensions.InternalArgs = $Extensions.DefaultArgs> = {
    /**
     * Select specific fields to fetch from the platform_api_configs
     */
    select?: platform_api_configsSelect<ExtArgs> | null
    /**
     * Filter, which platform_api_configs to fetch.
     */
    where?: platform_api_configsWhereInput
    /**
     * {@link https://www.prisma.io/docs/concepts/components/prisma-client/sorting Sorting Docs}
     * 
     * Determine the order of platform_api_configs to fetch.
     */
    orderBy?: platform_api_configsOrderByWithRelationInput | platform_api_configsOrderByWithRelationInput[]
    /**
     * {@link https://www.prisma.io/docs/concepts/components/prisma-client/pagination#cursor-based-pagination Cursor Docs}
     * 
     * Sets the position for searching for platform_api_configs.
     */
    cursor?: platform_api_configsWhereUniqueInput
    /**
     * {@link https://www.prisma.io/docs/concepts/components/prisma-client/pagination Pagination Docs}
     * 
     * Take `±n` platform_api_configs from the position of the cursor.
     */
    take?: number
    /**
     * {@link https://www.prisma.io/docs/concepts/components/prisma-client/pagination Pagination Docs}
     * 
     * Skip the first `n` platform_api_configs.
     */
    skip?: number
    /**
     * {@link https://www.prisma.io/docs/concepts/components/prisma-client/distinct Distinct Docs}
     * 
     * Filter by unique combinations of platform_api_configs.
     */
    distinct?: Platform_api_configsScalarFieldEnum | Platform_api_configsScalarFieldEnum[]
  }

  /**
   * platform_api_configs findFirstOrThrow
   */
  export type platform_api_configsFindFirstOrThrowArgs<ExtArgs extends $Extensions.InternalArgs = $Extensions.DefaultArgs> = {
    /**
     * Select specific fields to fetch from the platform_api_configs
     */
    select?: platform_api_configsSelect<ExtArgs> | null
    /**
     * Filter, which platform_api_configs to fetch.
     */
    where?: platform_api_configsWhereInput
    /**
     * {@link https://www.prisma.io/docs/concepts/components/prisma-client/sorting Sorting Docs}
     * 
     * Determine the order of platform_api_configs to fetch.
     */
    orderBy?: platform_api_configsOrderByWithRelationInput | platform_api_configsOrderByWithRelationInput[]
    /**
     * {@link https://www.prisma.io/docs/concepts/components/prisma-client/pagination#cursor-based-pagination Cursor Docs}
     * 
     * Sets the position for searching for platform_api_configs.
     */
    cursor?: platform_api_configsWhereUniqueInput
    /**
     * {@link https://www.prisma.io/docs/concepts/components/prisma-client/pagination Pagination Docs}
     * 
     * Take `±n` platform_api_configs from the position of the cursor.
     */
    take?: number
    /**
     * {@link https://www.prisma.io/docs/concepts/components/prisma-client/pagination Pagination Docs}
     * 
     * Skip the first `n` platform_api_configs.
     */
    skip?: number
    /**
     * {@link https://www.prisma.io/docs/concepts/components/prisma-client/distinct Distinct Docs}
     * 
     * Filter by unique combinations of platform_api_configs.
     */
    distinct?: Platform_api_configsScalarFieldEnum | Platform_api_configsScalarFieldEnum[]
  }

  /**
   * platform_api_configs findMany
   */
  export type platform_api_configsFindManyArgs<ExtArgs extends $Extensions.InternalArgs = $Extensions.DefaultArgs> = {
    /**
     * Select specific fields to fetch from the platform_api_configs
     */
    select?: platform_api_configsSelect<ExtArgs> | null
    /**
     * Filter, which platform_api_configs to fetch.
     */
    where?: platform_api_configsWhereInput
    /**
     * {@link https://www.prisma.io/docs/concepts/components/prisma-client/sorting Sorting Docs}
     * 
     * Determine the order of platform_api_configs to fetch.
     */
    orderBy?: platform_api_configsOrderByWithRelationInput | platform_api_configsOrderByWithRelationInput[]
    /**
     * {@link https://www.prisma.io/docs/concepts/components/prisma-client/pagination#cursor-based-pagination Cursor Docs}
     * 
     * Sets the position for listing platform_api_configs.
     */
    cursor?: platform_api_configsWhereUniqueInput
    /**
     * {@link https://www.prisma.io/docs/concepts/components/prisma-client/pagination Pagination Docs}
     * 
     * Take `±n` platform_api_configs from the position of the cursor.
     */
    take?: number
    /**
     * {@link https://www.prisma.io/docs/concepts/components/prisma-client/pagination Pagination Docs}
     * 
     * Skip the first `n` platform_api_configs.
     */
    skip?: number
    distinct?: Platform_api_configsScalarFieldEnum | Platform_api_configsScalarFieldEnum[]
  }

  /**
   * platform_api_configs create
   */
  export type platform_api_configsCreateArgs<ExtArgs extends $Extensions.InternalArgs = $Extensions.DefaultArgs> = {
    /**
     * Select specific fields to fetch from the platform_api_configs
     */
    select?: platform_api_configsSelect<ExtArgs> | null
    /**
     * The data needed to create a platform_api_configs.
     */
    data?: XOR<platform_api_configsCreateInput, platform_api_configsUncheckedCreateInput>
  }

  /**
   * platform_api_configs createMany
   */
  export type platform_api_configsCreateManyArgs<ExtArgs extends $Extensions.InternalArgs = $Extensions.DefaultArgs> = {
    /**
     * The data used to create many platform_api_configs.
     */
    data: platform_api_configsCreateManyInput | platform_api_configsCreateManyInput[]
  }

  /**
   * platform_api_configs createManyAndReturn
   */
  export type platform_api_configsCreateManyAndReturnArgs<ExtArgs extends $Extensions.InternalArgs = $Extensions.DefaultArgs> = {
    /**
     * Select specific fields to fetch from the platform_api_configs
     */
    select?: platform_api_configsSelectCreateManyAndReturn<ExtArgs> | null
    /**
     * The data used to create many platform_api_configs.
     */
    data: platform_api_configsCreateManyInput | platform_api_configsCreateManyInput[]
  }

  /**
   * platform_api_configs update
   */
  export type platform_api_configsUpdateArgs<ExtArgs extends $Extensions.InternalArgs = $Extensions.DefaultArgs> = {
    /**
     * Select specific fields to fetch from the platform_api_configs
     */
    select?: platform_api_configsSelect<ExtArgs> | null
    /**
     * The data needed to update a platform_api_configs.
     */
    data: XOR<platform_api_configsUpdateInput, platform_api_configsUncheckedUpdateInput>
    /**
     * Choose, which platform_api_configs to update.
     */
    where: platform_api_configsWhereUniqueInput
  }

  /**
   * platform_api_configs updateMany
   */
  export type platform_api_configsUpdateManyArgs<ExtArgs extends $Extensions.InternalArgs = $Extensions.DefaultArgs> = {
    /**
     * The data used to update platform_api_configs.
     */
    data: XOR<platform_api_configsUpdateManyMutationInput, platform_api_configsUncheckedUpdateManyInput>
    /**
     * Filter which platform_api_configs to update
     */
    where?: platform_api_configsWhereInput
  }

  /**
   * platform_api_configs upsert
   */
  export type platform_api_configsUpsertArgs<ExtArgs extends $Extensions.InternalArgs = $Extensions.DefaultArgs> = {
    /**
     * Select specific fields to fetch from the platform_api_configs
     */
    select?: platform_api_configsSelect<ExtArgs> | null
    /**
     * The filter to search for the platform_api_configs to update in case it exists.
     */
    where: platform_api_configsWhereUniqueInput
    /**
     * In case the platform_api_configs found by the `where` argument doesn't exist, create a new platform_api_configs with this data.
     */
    create: XOR<platform_api_configsCreateInput, platform_api_configsUncheckedCreateInput>
    /**
     * In case the platform_api_configs was found with the provided `where` argument, update it with this data.
     */
    update: XOR<platform_api_configsUpdateInput, platform_api_configsUncheckedUpdateInput>
  }

  /**
   * platform_api_configs delete
   */
  export type platform_api_configsDeleteArgs<ExtArgs extends $Extensions.InternalArgs = $Extensions.DefaultArgs> = {
    /**
     * Select specific fields to fetch from the platform_api_configs
     */
    select?: platform_api_configsSelect<ExtArgs> | null
    /**
     * Filter which platform_api_configs to delete.
     */
    where: platform_api_configsWhereUniqueInput
  }

  /**
   * platform_api_configs deleteMany
   */
  export type platform_api_configsDeleteManyArgs<ExtArgs extends $Extensions.InternalArgs = $Extensions.DefaultArgs> = {
    /**
     * Filter which platform_api_configs to delete
     */
    where?: platform_api_configsWhereInput
  }

  /**
   * platform_api_configs without action
   */
  export type platform_api_configsDefaultArgs<ExtArgs extends $Extensions.InternalArgs = $Extensions.DefaultArgs> = {
    /**
     * Select specific fields to fetch from the platform_api_configs
     */
    select?: platform_api_configsSelect<ExtArgs> | null
  }


  /**
   * Model platform_settings
   */

  export type AggregatePlatform_settings = {
    _count: Platform_settingsCountAggregateOutputType | null
    _min: Platform_settingsMinAggregateOutputType | null
    _max: Platform_settingsMaxAggregateOutputType | null
  }

  export type Platform_settingsMinAggregateOutputType = {
    key: string | null
    value: string | null
    createdAt: Date | null
    updatedAt: Date | null
  }

  export type Platform_settingsMaxAggregateOutputType = {
    key: string | null
    value: string | null
    createdAt: Date | null
    updatedAt: Date | null
  }

  export type Platform_settingsCountAggregateOutputType = {
    key: number
    value: number
    createdAt: number
    updatedAt: number
    _all: number
  }


  export type Platform_settingsMinAggregateInputType = {
    key?: true
    value?: true
    createdAt?: true
    updatedAt?: true
  }

  export type Platform_settingsMaxAggregateInputType = {
    key?: true
    value?: true
    createdAt?: true
    updatedAt?: true
  }

  export type Platform_settingsCountAggregateInputType = {
    key?: true
    value?: true
    createdAt?: true
    updatedAt?: true
    _all?: true
  }

  export type Platform_settingsAggregateArgs<ExtArgs extends $Extensions.InternalArgs = $Extensions.DefaultArgs> = {
    /**
     * Filter which platform_settings to aggregate.
     */
    where?: platform_settingsWhereInput
    /**
     * {@link https://www.prisma.io/docs/concepts/components/prisma-client/sorting Sorting Docs}
     * 
     * Determine the order of platform_settings to fetch.
     */
    orderBy?: platform_settingsOrderByWithRelationInput | platform_settingsOrderByWithRelationInput[]
    /**
     * {@link https://www.prisma.io/docs/concepts/components/prisma-client/pagination#cursor-based-pagination Cursor Docs}
     * 
     * Sets the start position
     */
    cursor?: platform_settingsWhereUniqueInput
    /**
     * {@link https://www.prisma.io/docs/concepts/components/prisma-client/pagination Pagination Docs}
     * 
     * Take `±n` platform_settings from the position of the cursor.
     */
    take?: number
    /**
     * {@link https://www.prisma.io/docs/concepts/components/prisma-client/pagination Pagination Docs}
     * 
     * Skip the first `n` platform_settings.
     */
    skip?: number
    /**
     * {@link https://www.prisma.io/docs/concepts/components/prisma-client/aggregations Aggregation Docs}
     * 
     * Count returned platform_settings
    **/
    _count?: true | Platform_settingsCountAggregateInputType
    /**
     * {@link https://www.prisma.io/docs/concepts/components/prisma-client/aggregations Aggregation Docs}
     * 
     * Select which fields to find the minimum value
    **/
    _min?: Platform_settingsMinAggregateInputType
    /**
     * {@link https://www.prisma.io/docs/concepts/components/prisma-client/aggregations Aggregation Docs}
     * 
     * Select which fields to find the maximum value
    **/
    _max?: Platform_settingsMaxAggregateInputType
  }

  export type GetPlatform_settingsAggregateType<T extends Platform_settingsAggregateArgs> = {
        [P in keyof T & keyof AggregatePlatform_settings]: P extends '_count' | 'count'
      ? T[P] extends true
        ? number
        : GetScalarType<T[P], AggregatePlatform_settings[P]>
      : GetScalarType<T[P], AggregatePlatform_settings[P]>
  }




  export type platform_settingsGroupByArgs<ExtArgs extends $Extensions.InternalArgs = $Extensions.DefaultArgs> = {
    where?: platform_settingsWhereInput
    orderBy?: platform_settingsOrderByWithAggregationInput | platform_settingsOrderByWithAggregationInput[]
    by: Platform_settingsScalarFieldEnum[] | Platform_settingsScalarFieldEnum
    having?: platform_settingsScalarWhereWithAggregatesInput
    take?: number
    skip?: number
    _count?: Platform_settingsCountAggregateInputType | true
    _min?: Platform_settingsMinAggregateInputType
    _max?: Platform_settingsMaxAggregateInputType
  }

  export type Platform_settingsGroupByOutputType = {
    key: string
    value: string
    createdAt: Date
    updatedAt: Date
    _count: Platform_settingsCountAggregateOutputType | null
    _min: Platform_settingsMinAggregateOutputType | null
    _max: Platform_settingsMaxAggregateOutputType | null
  }

  type GetPlatform_settingsGroupByPayload<T extends platform_settingsGroupByArgs> = Prisma.PrismaPromise<
    Array<
      PickEnumerable<Platform_settingsGroupByOutputType, T['by']> &
        {
          [P in ((keyof T) & (keyof Platform_settingsGroupByOutputType))]: P extends '_count'
            ? T[P] extends boolean
              ? number
              : GetScalarType<T[P], Platform_settingsGroupByOutputType[P]>
            : GetScalarType<T[P], Platform_settingsGroupByOutputType[P]>
        }
      >
    >


  export type platform_settingsSelect<ExtArgs extends $Extensions.InternalArgs = $Extensions.DefaultArgs> = $Extensions.GetSelect<{
    key?: boolean
    value?: boolean
    createdAt?: boolean
    updatedAt?: boolean
  }, ExtArgs["result"]["platform_settings"]>

  export type platform_settingsSelectCreateManyAndReturn<ExtArgs extends $Extensions.InternalArgs = $Extensions.DefaultArgs> = $Extensions.GetSelect<{
    key?: boolean
    value?: boolean
    createdAt?: boolean
    updatedAt?: boolean
  }, ExtArgs["result"]["platform_settings"]>

  export type platform_settingsSelectScalar = {
    key?: boolean
    value?: boolean
    createdAt?: boolean
    updatedAt?: boolean
  }


  export type $platform_settingsPayload<ExtArgs extends $Extensions.InternalArgs = $Extensions.DefaultArgs> = {
    name: "platform_settings"
    objects: {}
    scalars: $Extensions.GetPayloadResult<{
      key: string
      value: string
      createdAt: Date
      updatedAt: Date
    }, ExtArgs["result"]["platform_settings"]>
    composites: {}
  }

  type platform_settingsGetPayload<S extends boolean | null | undefined | platform_settingsDefaultArgs> = $Result.GetResult<Prisma.$platform_settingsPayload, S>

  type platform_settingsCountArgs<ExtArgs extends $Extensions.InternalArgs = $Extensions.DefaultArgs> = 
    Omit<platform_settingsFindManyArgs, 'select' | 'include' | 'distinct'> & {
      select?: Platform_settingsCountAggregateInputType | true
    }

  export interface platform_settingsDelegate<ExtArgs extends $Extensions.InternalArgs = $Extensions.DefaultArgs> {
    [K: symbol]: { types: Prisma.TypeMap<ExtArgs>['model']['platform_settings'], meta: { name: 'platform_settings' } }
    /**
     * Find zero or one Platform_settings that matches the filter.
     * @param {platform_settingsFindUniqueArgs} args - Arguments to find a Platform_settings
     * @example
     * // Get one Platform_settings
     * const platform_settings = await prisma.platform_settings.findUnique({
     *   where: {
     *     // ... provide filter here
     *   }
     * })
     */
    findUnique<T extends platform_settingsFindUniqueArgs>(args: SelectSubset<T, platform_settingsFindUniqueArgs<ExtArgs>>): Prisma__platform_settingsClient<$Result.GetResult<Prisma.$platform_settingsPayload<ExtArgs>, T, "findUnique"> | null, null, ExtArgs>

    /**
     * Find one Platform_settings that matches the filter or throw an error with `error.code='P2025'` 
     * if no matches were found.
     * @param {platform_settingsFindUniqueOrThrowArgs} args - Arguments to find a Platform_settings
     * @example
     * // Get one Platform_settings
     * const platform_settings = await prisma.platform_settings.findUniqueOrThrow({
     *   where: {
     *     // ... provide filter here
     *   }
     * })
     */
    findUniqueOrThrow<T extends platform_settingsFindUniqueOrThrowArgs>(args: SelectSubset<T, platform_settingsFindUniqueOrThrowArgs<ExtArgs>>): Prisma__platform_settingsClient<$Result.GetResult<Prisma.$platform_settingsPayload<ExtArgs>, T, "findUniqueOrThrow">, never, ExtArgs>

    /**
     * Find the first Platform_settings that matches the filter.
     * Note, that providing `undefined` is treated as the value not being there.
     * Read more here: https://pris.ly/d/null-undefined
     * @param {platform_settingsFindFirstArgs} args - Arguments to find a Platform_settings
     * @example
     * // Get one Platform_settings
     * const platform_settings = await prisma.platform_settings.findFirst({
     *   where: {
     *     // ... provide filter here
     *   }
     * })
     */
    findFirst<T extends platform_settingsFindFirstArgs>(args?: SelectSubset<T, platform_settingsFindFirstArgs<ExtArgs>>): Prisma__platform_settingsClient<$Result.GetResult<Prisma.$platform_settingsPayload<ExtArgs>, T, "findFirst"> | null, null, ExtArgs>

    /**
     * Find the first Platform_settings that matches the filter or
     * throw `PrismaKnownClientError` with `P2025` code if no matches were found.
     * Note, that providing `undefined` is treated as the value not being there.
     * Read more here: https://pris.ly/d/null-undefined
     * @param {platform_settingsFindFirstOrThrowArgs} args - Arguments to find a Platform_settings
     * @example
     * // Get one Platform_settings
     * const platform_settings = await prisma.platform_settings.findFirstOrThrow({
     *   where: {
     *     // ... provide filter here
     *   }
     * })
     */
    findFirstOrThrow<T extends platform_settingsFindFirstOrThrowArgs>(args?: SelectSubset<T, platform_settingsFindFirstOrThrowArgs<ExtArgs>>): Prisma__platform_settingsClient<$Result.GetResult<Prisma.$platform_settingsPayload<ExtArgs>, T, "findFirstOrThrow">, never, ExtArgs>

    /**
     * Find zero or more Platform_settings that matches the filter.
     * Note, that providing `undefined` is treated as the value not being there.
     * Read more here: https://pris.ly/d/null-undefined
     * @param {platform_settingsFindManyArgs} args - Arguments to filter and select certain fields only.
     * @example
     * // Get all Platform_settings
     * const platform_settings = await prisma.platform_settings.findMany()
     * 
     * // Get first 10 Platform_settings
     * const platform_settings = await prisma.platform_settings.findMany({ take: 10 })
     * 
     * // Only select the `key`
     * const platform_settingsWithKeyOnly = await prisma.platform_settings.findMany({ select: { key: true } })
     * 
     */
    findMany<T extends platform_settingsFindManyArgs>(args?: SelectSubset<T, platform_settingsFindManyArgs<ExtArgs>>): Prisma.PrismaPromise<$Result.GetResult<Prisma.$platform_settingsPayload<ExtArgs>, T, "findMany">>

    /**
     * Create a Platform_settings.
     * @param {platform_settingsCreateArgs} args - Arguments to create a Platform_settings.
     * @example
     * // Create one Platform_settings
     * const Platform_settings = await prisma.platform_settings.create({
     *   data: {
     *     // ... data to create a Platform_settings
     *   }
     * })
     * 
     */
    create<T extends platform_settingsCreateArgs>(args: SelectSubset<T, platform_settingsCreateArgs<ExtArgs>>): Prisma__platform_settingsClient<$Result.GetResult<Prisma.$platform_settingsPayload<ExtArgs>, T, "create">, never, ExtArgs>

    /**
     * Create many Platform_settings.
     * @param {platform_settingsCreateManyArgs} args - Arguments to create many Platform_settings.
     * @example
     * // Create many Platform_settings
     * const platform_settings = await prisma.platform_settings.createMany({
     *   data: [
     *     // ... provide data here
     *   ]
     * })
     *     
     */
    createMany<T extends platform_settingsCreateManyArgs>(args?: SelectSubset<T, platform_settingsCreateManyArgs<ExtArgs>>): Prisma.PrismaPromise<BatchPayload>

    /**
     * Create many Platform_settings and returns the data saved in the database.
     * @param {platform_settingsCreateManyAndReturnArgs} args - Arguments to create many Platform_settings.
     * @example
     * // Create many Platform_settings
     * const platform_settings = await prisma.platform_settings.createManyAndReturn({
     *   data: [
     *     // ... provide data here
     *   ]
     * })
     * 
     * // Create many Platform_settings and only return the `key`
     * const platform_settingsWithKeyOnly = await prisma.platform_settings.createManyAndReturn({ 
     *   select: { key: true },
     *   data: [
     *     // ... provide data here
     *   ]
     * })
     * Note, that providing `undefined` is treated as the value not being there.
     * Read more here: https://pris.ly/d/null-undefined
     * 
     */
    createManyAndReturn<T extends platform_settingsCreateManyAndReturnArgs>(args?: SelectSubset<T, platform_settingsCreateManyAndReturnArgs<ExtArgs>>): Prisma.PrismaPromise<$Result.GetResult<Prisma.$platform_settingsPayload<ExtArgs>, T, "createManyAndReturn">>

    /**
     * Delete a Platform_settings.
     * @param {platform_settingsDeleteArgs} args - Arguments to delete one Platform_settings.
     * @example
     * // Delete one Platform_settings
     * const Platform_settings = await prisma.platform_settings.delete({
     *   where: {
     *     // ... filter to delete one Platform_settings
     *   }
     * })
     * 
     */
    delete<T extends platform_settingsDeleteArgs>(args: SelectSubset<T, platform_settingsDeleteArgs<ExtArgs>>): Prisma__platform_settingsClient<$Result.GetResult<Prisma.$platform_settingsPayload<ExtArgs>, T, "delete">, never, ExtArgs>

    /**
     * Update one Platform_settings.
     * @param {platform_settingsUpdateArgs} args - Arguments to update one Platform_settings.
     * @example
     * // Update one Platform_settings
     * const platform_settings = await prisma.platform_settings.update({
     *   where: {
     *     // ... provide filter here
     *   },
     *   data: {
     *     // ... provide data here
     *   }
     * })
     * 
     */
    update<T extends platform_settingsUpdateArgs>(args: SelectSubset<T, platform_settingsUpdateArgs<ExtArgs>>): Prisma__platform_settingsClient<$Result.GetResult<Prisma.$platform_settingsPayload<ExtArgs>, T, "update">, never, ExtArgs>

    /**
     * Delete zero or more Platform_settings.
     * @param {platform_settingsDeleteManyArgs} args - Arguments to filter Platform_settings to delete.
     * @example
     * // Delete a few Platform_settings
     * const { count } = await prisma.platform_settings.deleteMany({
     *   where: {
     *     // ... provide filter here
     *   }
     * })
     * 
     */
    deleteMany<T extends platform_settingsDeleteManyArgs>(args?: SelectSubset<T, platform_settingsDeleteManyArgs<ExtArgs>>): Prisma.PrismaPromise<BatchPayload>

    /**
     * Update zero or more Platform_settings.
     * Note, that providing `undefined` is treated as the value not being there.
     * Read more here: https://pris.ly/d/null-undefined
     * @param {platform_settingsUpdateManyArgs} args - Arguments to update one or more rows.
     * @example
     * // Update many Platform_settings
     * const platform_settings = await prisma.platform_settings.updateMany({
     *   where: {
     *     // ... provide filter here
     *   },
     *   data: {
     *     // ... provide data here
     *   }
     * })
     * 
     */
    updateMany<T extends platform_settingsUpdateManyArgs>(args: SelectSubset<T, platform_settingsUpdateManyArgs<ExtArgs>>): Prisma.PrismaPromise<BatchPayload>

    /**
     * Create or update one Platform_settings.
     * @param {platform_settingsUpsertArgs} args - Arguments to update or create a Platform_settings.
     * @example
     * // Update or create a Platform_settings
     * const platform_settings = await prisma.platform_settings.upsert({
     *   create: {
     *     // ... data to create a Platform_settings
     *   },
     *   update: {
     *     // ... in case it already exists, update
     *   },
     *   where: {
     *     // ... the filter for the Platform_settings we want to update
     *   }
     * })
     */
    upsert<T extends platform_settingsUpsertArgs>(args: SelectSubset<T, platform_settingsUpsertArgs<ExtArgs>>): Prisma__platform_settingsClient<$Result.GetResult<Prisma.$platform_settingsPayload<ExtArgs>, T, "upsert">, never, ExtArgs>


    /**
     * Count the number of Platform_settings.
     * Note, that providing `undefined` is treated as the value not being there.
     * Read more here: https://pris.ly/d/null-undefined
     * @param {platform_settingsCountArgs} args - Arguments to filter Platform_settings to count.
     * @example
     * // Count the number of Platform_settings
     * const count = await prisma.platform_settings.count({
     *   where: {
     *     // ... the filter for the Platform_settings we want to count
     *   }
     * })
    **/
    count<T extends platform_settingsCountArgs>(
      args?: Subset<T, platform_settingsCountArgs>,
    ): Prisma.PrismaPromise<
      T extends $Utils.Record<'select', any>
        ? T['select'] extends true
          ? number
          : GetScalarType<T['select'], Platform_settingsCountAggregateOutputType>
        : number
    >

    /**
     * Allows you to perform aggregations operations on a Platform_settings.
     * Note, that providing `undefined` is treated as the value not being there.
     * Read more here: https://pris.ly/d/null-undefined
     * @param {Platform_settingsAggregateArgs} args - Select which aggregations you would like to apply and on what fields.
     * @example
     * // Ordered by age ascending
     * // Where email contains prisma.io
     * // Limited to the 10 users
     * const aggregations = await prisma.user.aggregate({
     *   _avg: {
     *     age: true,
     *   },
     *   where: {
     *     email: {
     *       contains: "prisma.io",
     *     },
     *   },
     *   orderBy: {
     *     age: "asc",
     *   },
     *   take: 10,
     * })
    **/
    aggregate<T extends Platform_settingsAggregateArgs>(args: Subset<T, Platform_settingsAggregateArgs>): Prisma.PrismaPromise<GetPlatform_settingsAggregateType<T>>

    /**
     * Group by Platform_settings.
     * Note, that providing `undefined` is treated as the value not being there.
     * Read more here: https://pris.ly/d/null-undefined
     * @param {platform_settingsGroupByArgs} args - Group by arguments.
     * @example
     * // Group by city, order by createdAt, get count
     * const result = await prisma.user.groupBy({
     *   by: ['city', 'createdAt'],
     *   orderBy: {
     *     createdAt: true
     *   },
     *   _count: {
     *     _all: true
     *   },
     * })
     * 
    **/
    groupBy<
      T extends platform_settingsGroupByArgs,
      HasSelectOrTake extends Or<
        Extends<'skip', Keys<T>>,
        Extends<'take', Keys<T>>
      >,
      OrderByArg extends True extends HasSelectOrTake
        ? { orderBy: platform_settingsGroupByArgs['orderBy'] }
        : { orderBy?: platform_settingsGroupByArgs['orderBy'] },
      OrderFields extends ExcludeUnderscoreKeys<Keys<MaybeTupleToUnion<T['orderBy']>>>,
      ByFields extends MaybeTupleToUnion<T['by']>,
      ByValid extends Has<ByFields, OrderFields>,
      HavingFields extends GetHavingFields<T['having']>,
      HavingValid extends Has<ByFields, HavingFields>,
      ByEmpty extends T['by'] extends never[] ? True : False,
      InputErrors extends ByEmpty extends True
      ? `Error: "by" must not be empty.`
      : HavingValid extends False
      ? {
          [P in HavingFields]: P extends ByFields
            ? never
            : P extends string
            ? `Error: Field "${P}" used in "having" needs to be provided in "by".`
            : [
                Error,
                'Field ',
                P,
                ` in "having" needs to be provided in "by"`,
              ]
        }[HavingFields]
      : 'take' extends Keys<T>
      ? 'orderBy' extends Keys<T>
        ? ByValid extends True
          ? {}
          : {
              [P in OrderFields]: P extends ByFields
                ? never
                : `Error: Field "${P}" in "orderBy" needs to be provided in "by"`
            }[OrderFields]
        : 'Error: If you provide "take", you also need to provide "orderBy"'
      : 'skip' extends Keys<T>
      ? 'orderBy' extends Keys<T>
        ? ByValid extends True
          ? {}
          : {
              [P in OrderFields]: P extends ByFields
                ? never
                : `Error: Field "${P}" in "orderBy" needs to be provided in "by"`
            }[OrderFields]
        : 'Error: If you provide "skip", you also need to provide "orderBy"'
      : ByValid extends True
      ? {}
      : {
          [P in OrderFields]: P extends ByFields
            ? never
            : `Error: Field "${P}" in "orderBy" needs to be provided in "by"`
        }[OrderFields]
    >(args: SubsetIntersection<T, platform_settingsGroupByArgs, OrderByArg> & InputErrors): {} extends InputErrors ? GetPlatform_settingsGroupByPayload<T> : Prisma.PrismaPromise<InputErrors>
  /**
   * Fields of the platform_settings model
   */
  readonly fields: platform_settingsFieldRefs;
  }

  /**
   * The delegate class that acts as a "Promise-like" for platform_settings.
   * Why is this prefixed with `Prisma__`?
   * Because we want to prevent naming conflicts as mentioned in
   * https://github.com/prisma/prisma-client-js/issues/707
   */
  export interface Prisma__platform_settingsClient<T, Null = never, ExtArgs extends $Extensions.InternalArgs = $Extensions.DefaultArgs> extends Prisma.PrismaPromise<T> {
    readonly [Symbol.toStringTag]: "PrismaPromise"
    /**
     * Attaches callbacks for the resolution and/or rejection of the Promise.
     * @param onfulfilled The callback to execute when the Promise is resolved.
     * @param onrejected The callback to execute when the Promise is rejected.
     * @returns A Promise for the completion of which ever callback is executed.
     */
    then<TResult1 = T, TResult2 = never>(onfulfilled?: ((value: T) => TResult1 | PromiseLike<TResult1>) | undefined | null, onrejected?: ((reason: any) => TResult2 | PromiseLike<TResult2>) | undefined | null): $Utils.JsPromise<TResult1 | TResult2>
    /**
     * Attaches a callback for only the rejection of the Promise.
     * @param onrejected The callback to execute when the Promise is rejected.
     * @returns A Promise for the completion of the callback.
     */
    catch<TResult = never>(onrejected?: ((reason: any) => TResult | PromiseLike<TResult>) | undefined | null): $Utils.JsPromise<T | TResult>
    /**
     * Attaches a callback that is invoked when the Promise is settled (fulfilled or rejected). The
     * resolved value cannot be modified from the callback.
     * @param onfinally The callback to execute when the Promise is settled (fulfilled or rejected).
     * @returns A Promise for the completion of the callback.
     */
    finally(onfinally?: (() => void) | undefined | null): $Utils.JsPromise<T>
  }




  /**
   * Fields of the platform_settings model
   */ 
  interface platform_settingsFieldRefs {
    readonly key: FieldRef<"platform_settings", 'String'>
    readonly value: FieldRef<"platform_settings", 'String'>
    readonly createdAt: FieldRef<"platform_settings", 'DateTime'>
    readonly updatedAt: FieldRef<"platform_settings", 'DateTime'>
  }
    

  // Custom InputTypes
  /**
   * platform_settings findUnique
   */
  export type platform_settingsFindUniqueArgs<ExtArgs extends $Extensions.InternalArgs = $Extensions.DefaultArgs> = {
    /**
     * Select specific fields to fetch from the platform_settings
     */
    select?: platform_settingsSelect<ExtArgs> | null
    /**
     * Filter, which platform_settings to fetch.
     */
    where: platform_settingsWhereUniqueInput
  }

  /**
   * platform_settings findUniqueOrThrow
   */
  export type platform_settingsFindUniqueOrThrowArgs<ExtArgs extends $Extensions.InternalArgs = $Extensions.DefaultArgs> = {
    /**
     * Select specific fields to fetch from the platform_settings
     */
    select?: platform_settingsSelect<ExtArgs> | null
    /**
     * Filter, which platform_settings to fetch.
     */
    where: platform_settingsWhereUniqueInput
  }

  /**
   * platform_settings findFirst
   */
  export type platform_settingsFindFirstArgs<ExtArgs extends $Extensions.InternalArgs = $Extensions.DefaultArgs> = {
    /**
     * Select specific fields to fetch from the platform_settings
     */
    select?: platform_settingsSelect<ExtArgs> | null
    /**
     * Filter, which platform_settings to fetch.
     */
    where?: platform_settingsWhereInput
    /**
     * {@link https://www.prisma.io/docs/concepts/components/prisma-client/sorting Sorting Docs}
     * 
     * Determine the order of platform_settings to fetch.
     */
    orderBy?: platform_settingsOrderByWithRelationInput | platform_settingsOrderByWithRelationInput[]
    /**
     * {@link https://www.prisma.io/docs/concepts/components/prisma-client/pagination#cursor-based-pagination Cursor Docs}
     * 
     * Sets the position for searching for platform_settings.
     */
    cursor?: platform_settingsWhereUniqueInput
    /**
     * {@link https://www.prisma.io/docs/concepts/components/prisma-client/pagination Pagination Docs}
     * 
     * Take `±n` platform_settings from the position of the cursor.
     */
    take?: number
    /**
     * {@link https://www.prisma.io/docs/concepts/components/prisma-client/pagination Pagination Docs}
     * 
     * Skip the first `n` platform_settings.
     */
    skip?: number
    /**
     * {@link https://www.prisma.io/docs/concepts/components/prisma-client/distinct Distinct Docs}
     * 
     * Filter by unique combinations of platform_settings.
     */
    distinct?: Platform_settingsScalarFieldEnum | Platform_settingsScalarFieldEnum[]
  }

  /**
   * platform_settings findFirstOrThrow
   */
  export type platform_settingsFindFirstOrThrowArgs<ExtArgs extends $Extensions.InternalArgs = $Extensions.DefaultArgs> = {
    /**
     * Select specific fields to fetch from the platform_settings
     */
    select?: platform_settingsSelect<ExtArgs> | null
    /**
     * Filter, which platform_settings to fetch.
     */
    where?: platform_settingsWhereInput
    /**
     * {@link https://www.prisma.io/docs/concepts/components/prisma-client/sorting Sorting Docs}
     * 
     * Determine the order of platform_settings to fetch.
     */
    orderBy?: platform_settingsOrderByWithRelationInput | platform_settingsOrderByWithRelationInput[]
    /**
     * {@link https://www.prisma.io/docs/concepts/components/prisma-client/pagination#cursor-based-pagination Cursor Docs}
     * 
     * Sets the position for searching for platform_settings.
     */
    cursor?: platform_settingsWhereUniqueInput
    /**
     * {@link https://www.prisma.io/docs/concepts/components/prisma-client/pagination Pagination Docs}
     * 
     * Take `±n` platform_settings from the position of the cursor.
     */
    take?: number
    /**
     * {@link https://www.prisma.io/docs/concepts/components/prisma-client/pagination Pagination Docs}
     * 
     * Skip the first `n` platform_settings.
     */
    skip?: number
    /**
     * {@link https://www.prisma.io/docs/concepts/components/prisma-client/distinct Distinct Docs}
     * 
     * Filter by unique combinations of platform_settings.
     */
    distinct?: Platform_settingsScalarFieldEnum | Platform_settingsScalarFieldEnum[]
  }

  /**
   * platform_settings findMany
   */
  export type platform_settingsFindManyArgs<ExtArgs extends $Extensions.InternalArgs = $Extensions.DefaultArgs> = {
    /**
     * Select specific fields to fetch from the platform_settings
     */
    select?: platform_settingsSelect<ExtArgs> | null
    /**
     * Filter, which platform_settings to fetch.
     */
    where?: platform_settingsWhereInput
    /**
     * {@link https://www.prisma.io/docs/concepts/components/prisma-client/sorting Sorting Docs}
     * 
     * Determine the order of platform_settings to fetch.
     */
    orderBy?: platform_settingsOrderByWithRelationInput | platform_settingsOrderByWithRelationInput[]
    /**
     * {@link https://www.prisma.io/docs/concepts/components/prisma-client/pagination#cursor-based-pagination Cursor Docs}
     * 
     * Sets the position for listing platform_settings.
     */
    cursor?: platform_settingsWhereUniqueInput
    /**
     * {@link https://www.prisma.io/docs/concepts/components/prisma-client/pagination Pagination Docs}
     * 
     * Take `±n` platform_settings from the position of the cursor.
     */
    take?: number
    /**
     * {@link https://www.prisma.io/docs/concepts/components/prisma-client/pagination Pagination Docs}
     * 
     * Skip the first `n` platform_settings.
     */
    skip?: number
    distinct?: Platform_settingsScalarFieldEnum | Platform_settingsScalarFieldEnum[]
  }

  /**
   * platform_settings create
   */
  export type platform_settingsCreateArgs<ExtArgs extends $Extensions.InternalArgs = $Extensions.DefaultArgs> = {
    /**
     * Select specific fields to fetch from the platform_settings
     */
    select?: platform_settingsSelect<ExtArgs> | null
    /**
     * The data needed to create a platform_settings.
     */
    data: XOR<platform_settingsCreateInput, platform_settingsUncheckedCreateInput>
  }

  /**
   * platform_settings createMany
   */
  export type platform_settingsCreateManyArgs<ExtArgs extends $Extensions.InternalArgs = $Extensions.DefaultArgs> = {
    /**
     * The data used to create many platform_settings.
     */
    data: platform_settingsCreateManyInput | platform_settingsCreateManyInput[]
  }

  /**
   * platform_settings createManyAndReturn
   */
  export type platform_settingsCreateManyAndReturnArgs<ExtArgs extends $Extensions.InternalArgs = $Extensions.DefaultArgs> = {
    /**
     * Select specific fields to fetch from the platform_settings
     */
    select?: platform_settingsSelectCreateManyAndReturn<ExtArgs> | null
    /**
     * The data used to create many platform_settings.
     */
    data: platform_settingsCreateManyInput | platform_settingsCreateManyInput[]
  }

  /**
   * platform_settings update
   */
  export type platform_settingsUpdateArgs<ExtArgs extends $Extensions.InternalArgs = $Extensions.DefaultArgs> = {
    /**
     * Select specific fields to fetch from the platform_settings
     */
    select?: platform_settingsSelect<ExtArgs> | null
    /**
     * The data needed to update a platform_settings.
     */
    data: XOR<platform_settingsUpdateInput, platform_settingsUncheckedUpdateInput>
    /**
     * Choose, which platform_settings to update.
     */
    where: platform_settingsWhereUniqueInput
  }

  /**
   * platform_settings updateMany
   */
  export type platform_settingsUpdateManyArgs<ExtArgs extends $Extensions.InternalArgs = $Extensions.DefaultArgs> = {
    /**
     * The data used to update platform_settings.
     */
    data: XOR<platform_settingsUpdateManyMutationInput, platform_settingsUncheckedUpdateManyInput>
    /**
     * Filter which platform_settings to update
     */
    where?: platform_settingsWhereInput
  }

  /**
   * platform_settings upsert
   */
  export type platform_settingsUpsertArgs<ExtArgs extends $Extensions.InternalArgs = $Extensions.DefaultArgs> = {
    /**
     * Select specific fields to fetch from the platform_settings
     */
    select?: platform_settingsSelect<ExtArgs> | null
    /**
     * The filter to search for the platform_settings to update in case it exists.
     */
    where: platform_settingsWhereUniqueInput
    /**
     * In case the platform_settings found by the `where` argument doesn't exist, create a new platform_settings with this data.
     */
    create: XOR<platform_settingsCreateInput, platform_settingsUncheckedCreateInput>
    /**
     * In case the platform_settings was found with the provided `where` argument, update it with this data.
     */
    update: XOR<platform_settingsUpdateInput, platform_settingsUncheckedUpdateInput>
  }

  /**
   * platform_settings delete
   */
  export type platform_settingsDeleteArgs<ExtArgs extends $Extensions.InternalArgs = $Extensions.DefaultArgs> = {
    /**
     * Select specific fields to fetch from the platform_settings
     */
    select?: platform_settingsSelect<ExtArgs> | null
    /**
     * Filter which platform_settings to delete.
     */
    where: platform_settingsWhereUniqueInput
  }

  /**
   * platform_settings deleteMany
   */
  export type platform_settingsDeleteManyArgs<ExtArgs extends $Extensions.InternalArgs = $Extensions.DefaultArgs> = {
    /**
     * Filter which platform_settings to delete
     */
    where?: platform_settingsWhereInput
  }

  /**
   * platform_settings without action
   */
  export type platform_settingsDefaultArgs<ExtArgs extends $Extensions.InternalArgs = $Extensions.DefaultArgs> = {
    /**
     * Select specific fields to fetch from the platform_settings
     */
    select?: platform_settingsSelect<ExtArgs> | null
  }


  /**
   * Model skill_model_configs
   */

  export type AggregateSkill_model_configs = {
    _count: Skill_model_configsCountAggregateOutputType | null
    _avg: Skill_model_configsAvgAggregateOutputType | null
    _sum: Skill_model_configsSumAggregateOutputType | null
    _min: Skill_model_configsMinAggregateOutputType | null
    _max: Skill_model_configsMaxAggregateOutputType | null
  }

  export type Skill_model_configsAvgAggregateOutputType = {
    temperature: number | null
    maxTokens: number | null
    requestTimeoutMs: number | null
  }

  export type Skill_model_configsSumAggregateOutputType = {
    temperature: number | null
    maxTokens: number | null
    requestTimeoutMs: number | null
  }

  export type Skill_model_configsMinAggregateOutputType = {
    id: string | null
    skillId: string | null
    tier: string | null
    model: string | null
    thinkingMode: string | null
    reasoningEffort: string | null
    endpoint: string | null
    apiKey: string | null
    temperature: number | null
    maxTokens: number | null
    requestTimeoutMs: number | null
    enabled: boolean | null
    createdAt: Date | null
    updatedAt: Date | null
  }

  export type Skill_model_configsMaxAggregateOutputType = {
    id: string | null
    skillId: string | null
    tier: string | null
    model: string | null
    thinkingMode: string | null
    reasoningEffort: string | null
    endpoint: string | null
    apiKey: string | null
    temperature: number | null
    maxTokens: number | null
    requestTimeoutMs: number | null
    enabled: boolean | null
    createdAt: Date | null
    updatedAt: Date | null
  }

  export type Skill_model_configsCountAggregateOutputType = {
    id: number
    skillId: number
    tier: number
    model: number
    thinkingMode: number
    reasoningEffort: number
    endpoint: number
    apiKey: number
    temperature: number
    maxTokens: number
    requestTimeoutMs: number
    enabled: number
    createdAt: number
    updatedAt: number
    _all: number
  }


  export type Skill_model_configsAvgAggregateInputType = {
    temperature?: true
    maxTokens?: true
    requestTimeoutMs?: true
  }

  export type Skill_model_configsSumAggregateInputType = {
    temperature?: true
    maxTokens?: true
    requestTimeoutMs?: true
  }

  export type Skill_model_configsMinAggregateInputType = {
    id?: true
    skillId?: true
    tier?: true
    model?: true
    thinkingMode?: true
    reasoningEffort?: true
    endpoint?: true
    apiKey?: true
    temperature?: true
    maxTokens?: true
    requestTimeoutMs?: true
    enabled?: true
    createdAt?: true
    updatedAt?: true
  }

  export type Skill_model_configsMaxAggregateInputType = {
    id?: true
    skillId?: true
    tier?: true
    model?: true
    thinkingMode?: true
    reasoningEffort?: true
    endpoint?: true
    apiKey?: true
    temperature?: true
    maxTokens?: true
    requestTimeoutMs?: true
    enabled?: true
    createdAt?: true
    updatedAt?: true
  }

  export type Skill_model_configsCountAggregateInputType = {
    id?: true
    skillId?: true
    tier?: true
    model?: true
    thinkingMode?: true
    reasoningEffort?: true
    endpoint?: true
    apiKey?: true
    temperature?: true
    maxTokens?: true
    requestTimeoutMs?: true
    enabled?: true
    createdAt?: true
    updatedAt?: true
    _all?: true
  }

  export type Skill_model_configsAggregateArgs<ExtArgs extends $Extensions.InternalArgs = $Extensions.DefaultArgs> = {
    /**
     * Filter which skill_model_configs to aggregate.
     */
    where?: skill_model_configsWhereInput
    /**
     * {@link https://www.prisma.io/docs/concepts/components/prisma-client/sorting Sorting Docs}
     * 
     * Determine the order of skill_model_configs to fetch.
     */
    orderBy?: skill_model_configsOrderByWithRelationInput | skill_model_configsOrderByWithRelationInput[]
    /**
     * {@link https://www.prisma.io/docs/concepts/components/prisma-client/pagination#cursor-based-pagination Cursor Docs}
     * 
     * Sets the start position
     */
    cursor?: skill_model_configsWhereUniqueInput
    /**
     * {@link https://www.prisma.io/docs/concepts/components/prisma-client/pagination Pagination Docs}
     * 
     * Take `±n` skill_model_configs from the position of the cursor.
     */
    take?: number
    /**
     * {@link https://www.prisma.io/docs/concepts/components/prisma-client/pagination Pagination Docs}
     * 
     * Skip the first `n` skill_model_configs.
     */
    skip?: number
    /**
     * {@link https://www.prisma.io/docs/concepts/components/prisma-client/aggregations Aggregation Docs}
     * 
     * Count returned skill_model_configs
    **/
    _count?: true | Skill_model_configsCountAggregateInputType
    /**
     * {@link https://www.prisma.io/docs/concepts/components/prisma-client/aggregations Aggregation Docs}
     * 
     * Select which fields to average
    **/
    _avg?: Skill_model_configsAvgAggregateInputType
    /**
     * {@link https://www.prisma.io/docs/concepts/components/prisma-client/aggregations Aggregation Docs}
     * 
     * Select which fields to sum
    **/
    _sum?: Skill_model_configsSumAggregateInputType
    /**
     * {@link https://www.prisma.io/docs/concepts/components/prisma-client/aggregations Aggregation Docs}
     * 
     * Select which fields to find the minimum value
    **/
    _min?: Skill_model_configsMinAggregateInputType
    /**
     * {@link https://www.prisma.io/docs/concepts/components/prisma-client/aggregations Aggregation Docs}
     * 
     * Select which fields to find the maximum value
    **/
    _max?: Skill_model_configsMaxAggregateInputType
  }

  export type GetSkill_model_configsAggregateType<T extends Skill_model_configsAggregateArgs> = {
        [P in keyof T & keyof AggregateSkill_model_configs]: P extends '_count' | 'count'
      ? T[P] extends true
        ? number
        : GetScalarType<T[P], AggregateSkill_model_configs[P]>
      : GetScalarType<T[P], AggregateSkill_model_configs[P]>
  }




  export type skill_model_configsGroupByArgs<ExtArgs extends $Extensions.InternalArgs = $Extensions.DefaultArgs> = {
    where?: skill_model_configsWhereInput
    orderBy?: skill_model_configsOrderByWithAggregationInput | skill_model_configsOrderByWithAggregationInput[]
    by: Skill_model_configsScalarFieldEnum[] | Skill_model_configsScalarFieldEnum
    having?: skill_model_configsScalarWhereWithAggregatesInput
    take?: number
    skip?: number
    _count?: Skill_model_configsCountAggregateInputType | true
    _avg?: Skill_model_configsAvgAggregateInputType
    _sum?: Skill_model_configsSumAggregateInputType
    _min?: Skill_model_configsMinAggregateInputType
    _max?: Skill_model_configsMaxAggregateInputType
  }

  export type Skill_model_configsGroupByOutputType = {
    id: string
    skillId: string
    tier: string
    model: string | null
    thinkingMode: string | null
    reasoningEffort: string | null
    endpoint: string | null
    apiKey: string | null
    temperature: number
    maxTokens: number
    requestTimeoutMs: number | null
    enabled: boolean
    createdAt: Date
    updatedAt: Date
    _count: Skill_model_configsCountAggregateOutputType | null
    _avg: Skill_model_configsAvgAggregateOutputType | null
    _sum: Skill_model_configsSumAggregateOutputType | null
    _min: Skill_model_configsMinAggregateOutputType | null
    _max: Skill_model_configsMaxAggregateOutputType | null
  }

  type GetSkill_model_configsGroupByPayload<T extends skill_model_configsGroupByArgs> = Prisma.PrismaPromise<
    Array<
      PickEnumerable<Skill_model_configsGroupByOutputType, T['by']> &
        {
          [P in ((keyof T) & (keyof Skill_model_configsGroupByOutputType))]: P extends '_count'
            ? T[P] extends boolean
              ? number
              : GetScalarType<T[P], Skill_model_configsGroupByOutputType[P]>
            : GetScalarType<T[P], Skill_model_configsGroupByOutputType[P]>
        }
      >
    >


  export type skill_model_configsSelect<ExtArgs extends $Extensions.InternalArgs = $Extensions.DefaultArgs> = $Extensions.GetSelect<{
    id?: boolean
    skillId?: boolean
    tier?: boolean
    model?: boolean
    thinkingMode?: boolean
    reasoningEffort?: boolean
    endpoint?: boolean
    apiKey?: boolean
    temperature?: boolean
    maxTokens?: boolean
    requestTimeoutMs?: boolean
    enabled?: boolean
    createdAt?: boolean
    updatedAt?: boolean
  }, ExtArgs["result"]["skill_model_configs"]>

  export type skill_model_configsSelectCreateManyAndReturn<ExtArgs extends $Extensions.InternalArgs = $Extensions.DefaultArgs> = $Extensions.GetSelect<{
    id?: boolean
    skillId?: boolean
    tier?: boolean
    model?: boolean
    thinkingMode?: boolean
    reasoningEffort?: boolean
    endpoint?: boolean
    apiKey?: boolean
    temperature?: boolean
    maxTokens?: boolean
    requestTimeoutMs?: boolean
    enabled?: boolean
    createdAt?: boolean
    updatedAt?: boolean
  }, ExtArgs["result"]["skill_model_configs"]>

  export type skill_model_configsSelectScalar = {
    id?: boolean
    skillId?: boolean
    tier?: boolean
    model?: boolean
    thinkingMode?: boolean
    reasoningEffort?: boolean
    endpoint?: boolean
    apiKey?: boolean
    temperature?: boolean
    maxTokens?: boolean
    requestTimeoutMs?: boolean
    enabled?: boolean
    createdAt?: boolean
    updatedAt?: boolean
  }


  export type $skill_model_configsPayload<ExtArgs extends $Extensions.InternalArgs = $Extensions.DefaultArgs> = {
    name: "skill_model_configs"
    objects: {}
    scalars: $Extensions.GetPayloadResult<{
      id: string
      skillId: string
      tier: string
      model: string | null
      thinkingMode: string | null
      reasoningEffort: string | null
      endpoint: string | null
      apiKey: string | null
      temperature: number
      maxTokens: number
      requestTimeoutMs: number | null
      enabled: boolean
      createdAt: Date
      updatedAt: Date
    }, ExtArgs["result"]["skill_model_configs"]>
    composites: {}
  }

  type skill_model_configsGetPayload<S extends boolean | null | undefined | skill_model_configsDefaultArgs> = $Result.GetResult<Prisma.$skill_model_configsPayload, S>

  type skill_model_configsCountArgs<ExtArgs extends $Extensions.InternalArgs = $Extensions.DefaultArgs> = 
    Omit<skill_model_configsFindManyArgs, 'select' | 'include' | 'distinct'> & {
      select?: Skill_model_configsCountAggregateInputType | true
    }

  export interface skill_model_configsDelegate<ExtArgs extends $Extensions.InternalArgs = $Extensions.DefaultArgs> {
    [K: symbol]: { types: Prisma.TypeMap<ExtArgs>['model']['skill_model_configs'], meta: { name: 'skill_model_configs' } }
    /**
     * Find zero or one Skill_model_configs that matches the filter.
     * @param {skill_model_configsFindUniqueArgs} args - Arguments to find a Skill_model_configs
     * @example
     * // Get one Skill_model_configs
     * const skill_model_configs = await prisma.skill_model_configs.findUnique({
     *   where: {
     *     // ... provide filter here
     *   }
     * })
     */
    findUnique<T extends skill_model_configsFindUniqueArgs>(args: SelectSubset<T, skill_model_configsFindUniqueArgs<ExtArgs>>): Prisma__skill_model_configsClient<$Result.GetResult<Prisma.$skill_model_configsPayload<ExtArgs>, T, "findUnique"> | null, null, ExtArgs>

    /**
     * Find one Skill_model_configs that matches the filter or throw an error with `error.code='P2025'` 
     * if no matches were found.
     * @param {skill_model_configsFindUniqueOrThrowArgs} args - Arguments to find a Skill_model_configs
     * @example
     * // Get one Skill_model_configs
     * const skill_model_configs = await prisma.skill_model_configs.findUniqueOrThrow({
     *   where: {
     *     // ... provide filter here
     *   }
     * })
     */
    findUniqueOrThrow<T extends skill_model_configsFindUniqueOrThrowArgs>(args: SelectSubset<T, skill_model_configsFindUniqueOrThrowArgs<ExtArgs>>): Prisma__skill_model_configsClient<$Result.GetResult<Prisma.$skill_model_configsPayload<ExtArgs>, T, "findUniqueOrThrow">, never, ExtArgs>

    /**
     * Find the first Skill_model_configs that matches the filter.
     * Note, that providing `undefined` is treated as the value not being there.
     * Read more here: https://pris.ly/d/null-undefined
     * @param {skill_model_configsFindFirstArgs} args - Arguments to find a Skill_model_configs
     * @example
     * // Get one Skill_model_configs
     * const skill_model_configs = await prisma.skill_model_configs.findFirst({
     *   where: {
     *     // ... provide filter here
     *   }
     * })
     */
    findFirst<T extends skill_model_configsFindFirstArgs>(args?: SelectSubset<T, skill_model_configsFindFirstArgs<ExtArgs>>): Prisma__skill_model_configsClient<$Result.GetResult<Prisma.$skill_model_configsPayload<ExtArgs>, T, "findFirst"> | null, null, ExtArgs>

    /**
     * Find the first Skill_model_configs that matches the filter or
     * throw `PrismaKnownClientError` with `P2025` code if no matches were found.
     * Note, that providing `undefined` is treated as the value not being there.
     * Read more here: https://pris.ly/d/null-undefined
     * @param {skill_model_configsFindFirstOrThrowArgs} args - Arguments to find a Skill_model_configs
     * @example
     * // Get one Skill_model_configs
     * const skill_model_configs = await prisma.skill_model_configs.findFirstOrThrow({
     *   where: {
     *     // ... provide filter here
     *   }
     * })
     */
    findFirstOrThrow<T extends skill_model_configsFindFirstOrThrowArgs>(args?: SelectSubset<T, skill_model_configsFindFirstOrThrowArgs<ExtArgs>>): Prisma__skill_model_configsClient<$Result.GetResult<Prisma.$skill_model_configsPayload<ExtArgs>, T, "findFirstOrThrow">, never, ExtArgs>

    /**
     * Find zero or more Skill_model_configs that matches the filter.
     * Note, that providing `undefined` is treated as the value not being there.
     * Read more here: https://pris.ly/d/null-undefined
     * @param {skill_model_configsFindManyArgs} args - Arguments to filter and select certain fields only.
     * @example
     * // Get all Skill_model_configs
     * const skill_model_configs = await prisma.skill_model_configs.findMany()
     * 
     * // Get first 10 Skill_model_configs
     * const skill_model_configs = await prisma.skill_model_configs.findMany({ take: 10 })
     * 
     * // Only select the `id`
     * const skill_model_configsWithIdOnly = await prisma.skill_model_configs.findMany({ select: { id: true } })
     * 
     */
    findMany<T extends skill_model_configsFindManyArgs>(args?: SelectSubset<T, skill_model_configsFindManyArgs<ExtArgs>>): Prisma.PrismaPromise<$Result.GetResult<Prisma.$skill_model_configsPayload<ExtArgs>, T, "findMany">>

    /**
     * Create a Skill_model_configs.
     * @param {skill_model_configsCreateArgs} args - Arguments to create a Skill_model_configs.
     * @example
     * // Create one Skill_model_configs
     * const Skill_model_configs = await prisma.skill_model_configs.create({
     *   data: {
     *     // ... data to create a Skill_model_configs
     *   }
     * })
     * 
     */
    create<T extends skill_model_configsCreateArgs>(args: SelectSubset<T, skill_model_configsCreateArgs<ExtArgs>>): Prisma__skill_model_configsClient<$Result.GetResult<Prisma.$skill_model_configsPayload<ExtArgs>, T, "create">, never, ExtArgs>

    /**
     * Create many Skill_model_configs.
     * @param {skill_model_configsCreateManyArgs} args - Arguments to create many Skill_model_configs.
     * @example
     * // Create many Skill_model_configs
     * const skill_model_configs = await prisma.skill_model_configs.createMany({
     *   data: [
     *     // ... provide data here
     *   ]
     * })
     *     
     */
    createMany<T extends skill_model_configsCreateManyArgs>(args?: SelectSubset<T, skill_model_configsCreateManyArgs<ExtArgs>>): Prisma.PrismaPromise<BatchPayload>

    /**
     * Create many Skill_model_configs and returns the data saved in the database.
     * @param {skill_model_configsCreateManyAndReturnArgs} args - Arguments to create many Skill_model_configs.
     * @example
     * // Create many Skill_model_configs
     * const skill_model_configs = await prisma.skill_model_configs.createManyAndReturn({
     *   data: [
     *     // ... provide data here
     *   ]
     * })
     * 
     * // Create many Skill_model_configs and only return the `id`
     * const skill_model_configsWithIdOnly = await prisma.skill_model_configs.createManyAndReturn({ 
     *   select: { id: true },
     *   data: [
     *     // ... provide data here
     *   ]
     * })
     * Note, that providing `undefined` is treated as the value not being there.
     * Read more here: https://pris.ly/d/null-undefined
     * 
     */
    createManyAndReturn<T extends skill_model_configsCreateManyAndReturnArgs>(args?: SelectSubset<T, skill_model_configsCreateManyAndReturnArgs<ExtArgs>>): Prisma.PrismaPromise<$Result.GetResult<Prisma.$skill_model_configsPayload<ExtArgs>, T, "createManyAndReturn">>

    /**
     * Delete a Skill_model_configs.
     * @param {skill_model_configsDeleteArgs} args - Arguments to delete one Skill_model_configs.
     * @example
     * // Delete one Skill_model_configs
     * const Skill_model_configs = await prisma.skill_model_configs.delete({
     *   where: {
     *     // ... filter to delete one Skill_model_configs
     *   }
     * })
     * 
     */
    delete<T extends skill_model_configsDeleteArgs>(args: SelectSubset<T, skill_model_configsDeleteArgs<ExtArgs>>): Prisma__skill_model_configsClient<$Result.GetResult<Prisma.$skill_model_configsPayload<ExtArgs>, T, "delete">, never, ExtArgs>

    /**
     * Update one Skill_model_configs.
     * @param {skill_model_configsUpdateArgs} args - Arguments to update one Skill_model_configs.
     * @example
     * // Update one Skill_model_configs
     * const skill_model_configs = await prisma.skill_model_configs.update({
     *   where: {
     *     // ... provide filter here
     *   },
     *   data: {
     *     // ... provide data here
     *   }
     * })
     * 
     */
    update<T extends skill_model_configsUpdateArgs>(args: SelectSubset<T, skill_model_configsUpdateArgs<ExtArgs>>): Prisma__skill_model_configsClient<$Result.GetResult<Prisma.$skill_model_configsPayload<ExtArgs>, T, "update">, never, ExtArgs>

    /**
     * Delete zero or more Skill_model_configs.
     * @param {skill_model_configsDeleteManyArgs} args - Arguments to filter Skill_model_configs to delete.
     * @example
     * // Delete a few Skill_model_configs
     * const { count } = await prisma.skill_model_configs.deleteMany({
     *   where: {
     *     // ... provide filter here
     *   }
     * })
     * 
     */
    deleteMany<T extends skill_model_configsDeleteManyArgs>(args?: SelectSubset<T, skill_model_configsDeleteManyArgs<ExtArgs>>): Prisma.PrismaPromise<BatchPayload>

    /**
     * Update zero or more Skill_model_configs.
     * Note, that providing `undefined` is treated as the value not being there.
     * Read more here: https://pris.ly/d/null-undefined
     * @param {skill_model_configsUpdateManyArgs} args - Arguments to update one or more rows.
     * @example
     * // Update many Skill_model_configs
     * const skill_model_configs = await prisma.skill_model_configs.updateMany({
     *   where: {
     *     // ... provide filter here
     *   },
     *   data: {
     *     // ... provide data here
     *   }
     * })
     * 
     */
    updateMany<T extends skill_model_configsUpdateManyArgs>(args: SelectSubset<T, skill_model_configsUpdateManyArgs<ExtArgs>>): Prisma.PrismaPromise<BatchPayload>

    /**
     * Create or update one Skill_model_configs.
     * @param {skill_model_configsUpsertArgs} args - Arguments to update or create a Skill_model_configs.
     * @example
     * // Update or create a Skill_model_configs
     * const skill_model_configs = await prisma.skill_model_configs.upsert({
     *   create: {
     *     // ... data to create a Skill_model_configs
     *   },
     *   update: {
     *     // ... in case it already exists, update
     *   },
     *   where: {
     *     // ... the filter for the Skill_model_configs we want to update
     *   }
     * })
     */
    upsert<T extends skill_model_configsUpsertArgs>(args: SelectSubset<T, skill_model_configsUpsertArgs<ExtArgs>>): Prisma__skill_model_configsClient<$Result.GetResult<Prisma.$skill_model_configsPayload<ExtArgs>, T, "upsert">, never, ExtArgs>


    /**
     * Count the number of Skill_model_configs.
     * Note, that providing `undefined` is treated as the value not being there.
     * Read more here: https://pris.ly/d/null-undefined
     * @param {skill_model_configsCountArgs} args - Arguments to filter Skill_model_configs to count.
     * @example
     * // Count the number of Skill_model_configs
     * const count = await prisma.skill_model_configs.count({
     *   where: {
     *     // ... the filter for the Skill_model_configs we want to count
     *   }
     * })
    **/
    count<T extends skill_model_configsCountArgs>(
      args?: Subset<T, skill_model_configsCountArgs>,
    ): Prisma.PrismaPromise<
      T extends $Utils.Record<'select', any>
        ? T['select'] extends true
          ? number
          : GetScalarType<T['select'], Skill_model_configsCountAggregateOutputType>
        : number
    >

    /**
     * Allows you to perform aggregations operations on a Skill_model_configs.
     * Note, that providing `undefined` is treated as the value not being there.
     * Read more here: https://pris.ly/d/null-undefined
     * @param {Skill_model_configsAggregateArgs} args - Select which aggregations you would like to apply and on what fields.
     * @example
     * // Ordered by age ascending
     * // Where email contains prisma.io
     * // Limited to the 10 users
     * const aggregations = await prisma.user.aggregate({
     *   _avg: {
     *     age: true,
     *   },
     *   where: {
     *     email: {
     *       contains: "prisma.io",
     *     },
     *   },
     *   orderBy: {
     *     age: "asc",
     *   },
     *   take: 10,
     * })
    **/
    aggregate<T extends Skill_model_configsAggregateArgs>(args: Subset<T, Skill_model_configsAggregateArgs>): Prisma.PrismaPromise<GetSkill_model_configsAggregateType<T>>

    /**
     * Group by Skill_model_configs.
     * Note, that providing `undefined` is treated as the value not being there.
     * Read more here: https://pris.ly/d/null-undefined
     * @param {skill_model_configsGroupByArgs} args - Group by arguments.
     * @example
     * // Group by city, order by createdAt, get count
     * const result = await prisma.user.groupBy({
     *   by: ['city', 'createdAt'],
     *   orderBy: {
     *     createdAt: true
     *   },
     *   _count: {
     *     _all: true
     *   },
     * })
     * 
    **/
    groupBy<
      T extends skill_model_configsGroupByArgs,
      HasSelectOrTake extends Or<
        Extends<'skip', Keys<T>>,
        Extends<'take', Keys<T>>
      >,
      OrderByArg extends True extends HasSelectOrTake
        ? { orderBy: skill_model_configsGroupByArgs['orderBy'] }
        : { orderBy?: skill_model_configsGroupByArgs['orderBy'] },
      OrderFields extends ExcludeUnderscoreKeys<Keys<MaybeTupleToUnion<T['orderBy']>>>,
      ByFields extends MaybeTupleToUnion<T['by']>,
      ByValid extends Has<ByFields, OrderFields>,
      HavingFields extends GetHavingFields<T['having']>,
      HavingValid extends Has<ByFields, HavingFields>,
      ByEmpty extends T['by'] extends never[] ? True : False,
      InputErrors extends ByEmpty extends True
      ? `Error: "by" must not be empty.`
      : HavingValid extends False
      ? {
          [P in HavingFields]: P extends ByFields
            ? never
            : P extends string
            ? `Error: Field "${P}" used in "having" needs to be provided in "by".`
            : [
                Error,
                'Field ',
                P,
                ` in "having" needs to be provided in "by"`,
              ]
        }[HavingFields]
      : 'take' extends Keys<T>
      ? 'orderBy' extends Keys<T>
        ? ByValid extends True
          ? {}
          : {
              [P in OrderFields]: P extends ByFields
                ? never
                : `Error: Field "${P}" in "orderBy" needs to be provided in "by"`
            }[OrderFields]
        : 'Error: If you provide "take", you also need to provide "orderBy"'
      : 'skip' extends Keys<T>
      ? 'orderBy' extends Keys<T>
        ? ByValid extends True
          ? {}
          : {
              [P in OrderFields]: P extends ByFields
                ? never
                : `Error: Field "${P}" in "orderBy" needs to be provided in "by"`
            }[OrderFields]
        : 'Error: If you provide "skip", you also need to provide "orderBy"'
      : ByValid extends True
      ? {}
      : {
          [P in OrderFields]: P extends ByFields
            ? never
            : `Error: Field "${P}" in "orderBy" needs to be provided in "by"`
        }[OrderFields]
    >(args: SubsetIntersection<T, skill_model_configsGroupByArgs, OrderByArg> & InputErrors): {} extends InputErrors ? GetSkill_model_configsGroupByPayload<T> : Prisma.PrismaPromise<InputErrors>
  /**
   * Fields of the skill_model_configs model
   */
  readonly fields: skill_model_configsFieldRefs;
  }

  /**
   * The delegate class that acts as a "Promise-like" for skill_model_configs.
   * Why is this prefixed with `Prisma__`?
   * Because we want to prevent naming conflicts as mentioned in
   * https://github.com/prisma/prisma-client-js/issues/707
   */
  export interface Prisma__skill_model_configsClient<T, Null = never, ExtArgs extends $Extensions.InternalArgs = $Extensions.DefaultArgs> extends Prisma.PrismaPromise<T> {
    readonly [Symbol.toStringTag]: "PrismaPromise"
    /**
     * Attaches callbacks for the resolution and/or rejection of the Promise.
     * @param onfulfilled The callback to execute when the Promise is resolved.
     * @param onrejected The callback to execute when the Promise is rejected.
     * @returns A Promise for the completion of which ever callback is executed.
     */
    then<TResult1 = T, TResult2 = never>(onfulfilled?: ((value: T) => TResult1 | PromiseLike<TResult1>) | undefined | null, onrejected?: ((reason: any) => TResult2 | PromiseLike<TResult2>) | undefined | null): $Utils.JsPromise<TResult1 | TResult2>
    /**
     * Attaches a callback for only the rejection of the Promise.
     * @param onrejected The callback to execute when the Promise is rejected.
     * @returns A Promise for the completion of the callback.
     */
    catch<TResult = never>(onrejected?: ((reason: any) => TResult | PromiseLike<TResult>) | undefined | null): $Utils.JsPromise<T | TResult>
    /**
     * Attaches a callback that is invoked when the Promise is settled (fulfilled or rejected). The
     * resolved value cannot be modified from the callback.
     * @param onfinally The callback to execute when the Promise is settled (fulfilled or rejected).
     * @returns A Promise for the completion of the callback.
     */
    finally(onfinally?: (() => void) | undefined | null): $Utils.JsPromise<T>
  }




  /**
   * Fields of the skill_model_configs model
   */ 
  interface skill_model_configsFieldRefs {
    readonly id: FieldRef<"skill_model_configs", 'String'>
    readonly skillId: FieldRef<"skill_model_configs", 'String'>
    readonly tier: FieldRef<"skill_model_configs", 'String'>
    readonly model: FieldRef<"skill_model_configs", 'String'>
    readonly thinkingMode: FieldRef<"skill_model_configs", 'String'>
    readonly reasoningEffort: FieldRef<"skill_model_configs", 'String'>
    readonly endpoint: FieldRef<"skill_model_configs", 'String'>
    readonly apiKey: FieldRef<"skill_model_configs", 'String'>
    readonly temperature: FieldRef<"skill_model_configs", 'Float'>
    readonly maxTokens: FieldRef<"skill_model_configs", 'Int'>
    readonly requestTimeoutMs: FieldRef<"skill_model_configs", 'Int'>
    readonly enabled: FieldRef<"skill_model_configs", 'Boolean'>
    readonly createdAt: FieldRef<"skill_model_configs", 'DateTime'>
    readonly updatedAt: FieldRef<"skill_model_configs", 'DateTime'>
  }
    

  // Custom InputTypes
  /**
   * skill_model_configs findUnique
   */
  export type skill_model_configsFindUniqueArgs<ExtArgs extends $Extensions.InternalArgs = $Extensions.DefaultArgs> = {
    /**
     * Select specific fields to fetch from the skill_model_configs
     */
    select?: skill_model_configsSelect<ExtArgs> | null
    /**
     * Filter, which skill_model_configs to fetch.
     */
    where: skill_model_configsWhereUniqueInput
  }

  /**
   * skill_model_configs findUniqueOrThrow
   */
  export type skill_model_configsFindUniqueOrThrowArgs<ExtArgs extends $Extensions.InternalArgs = $Extensions.DefaultArgs> = {
    /**
     * Select specific fields to fetch from the skill_model_configs
     */
    select?: skill_model_configsSelect<ExtArgs> | null
    /**
     * Filter, which skill_model_configs to fetch.
     */
    where: skill_model_configsWhereUniqueInput
  }

  /**
   * skill_model_configs findFirst
   */
  export type skill_model_configsFindFirstArgs<ExtArgs extends $Extensions.InternalArgs = $Extensions.DefaultArgs> = {
    /**
     * Select specific fields to fetch from the skill_model_configs
     */
    select?: skill_model_configsSelect<ExtArgs> | null
    /**
     * Filter, which skill_model_configs to fetch.
     */
    where?: skill_model_configsWhereInput
    /**
     * {@link https://www.prisma.io/docs/concepts/components/prisma-client/sorting Sorting Docs}
     * 
     * Determine the order of skill_model_configs to fetch.
     */
    orderBy?: skill_model_configsOrderByWithRelationInput | skill_model_configsOrderByWithRelationInput[]
    /**
     * {@link https://www.prisma.io/docs/concepts/components/prisma-client/pagination#cursor-based-pagination Cursor Docs}
     * 
     * Sets the position for searching for skill_model_configs.
     */
    cursor?: skill_model_configsWhereUniqueInput
    /**
     * {@link https://www.prisma.io/docs/concepts/components/prisma-client/pagination Pagination Docs}
     * 
     * Take `±n` skill_model_configs from the position of the cursor.
     */
    take?: number
    /**
     * {@link https://www.prisma.io/docs/concepts/components/prisma-client/pagination Pagination Docs}
     * 
     * Skip the first `n` skill_model_configs.
     */
    skip?: number
    /**
     * {@link https://www.prisma.io/docs/concepts/components/prisma-client/distinct Distinct Docs}
     * 
     * Filter by unique combinations of skill_model_configs.
     */
    distinct?: Skill_model_configsScalarFieldEnum | Skill_model_configsScalarFieldEnum[]
  }

  /**
   * skill_model_configs findFirstOrThrow
   */
  export type skill_model_configsFindFirstOrThrowArgs<ExtArgs extends $Extensions.InternalArgs = $Extensions.DefaultArgs> = {
    /**
     * Select specific fields to fetch from the skill_model_configs
     */
    select?: skill_model_configsSelect<ExtArgs> | null
    /**
     * Filter, which skill_model_configs to fetch.
     */
    where?: skill_model_configsWhereInput
    /**
     * {@link https://www.prisma.io/docs/concepts/components/prisma-client/sorting Sorting Docs}
     * 
     * Determine the order of skill_model_configs to fetch.
     */
    orderBy?: skill_model_configsOrderByWithRelationInput | skill_model_configsOrderByWithRelationInput[]
    /**
     * {@link https://www.prisma.io/docs/concepts/components/prisma-client/pagination#cursor-based-pagination Cursor Docs}
     * 
     * Sets the position for searching for skill_model_configs.
     */
    cursor?: skill_model_configsWhereUniqueInput
    /**
     * {@link https://www.prisma.io/docs/concepts/components/prisma-client/pagination Pagination Docs}
     * 
     * Take `±n` skill_model_configs from the position of the cursor.
     */
    take?: number
    /**
     * {@link https://www.prisma.io/docs/concepts/components/prisma-client/pagination Pagination Docs}
     * 
     * Skip the first `n` skill_model_configs.
     */
    skip?: number
    /**
     * {@link https://www.prisma.io/docs/concepts/components/prisma-client/distinct Distinct Docs}
     * 
     * Filter by unique combinations of skill_model_configs.
     */
    distinct?: Skill_model_configsScalarFieldEnum | Skill_model_configsScalarFieldEnum[]
  }

  /**
   * skill_model_configs findMany
   */
  export type skill_model_configsFindManyArgs<ExtArgs extends $Extensions.InternalArgs = $Extensions.DefaultArgs> = {
    /**
     * Select specific fields to fetch from the skill_model_configs
     */
    select?: skill_model_configsSelect<ExtArgs> | null
    /**
     * Filter, which skill_model_configs to fetch.
     */
    where?: skill_model_configsWhereInput
    /**
     * {@link https://www.prisma.io/docs/concepts/components/prisma-client/sorting Sorting Docs}
     * 
     * Determine the order of skill_model_configs to fetch.
     */
    orderBy?: skill_model_configsOrderByWithRelationInput | skill_model_configsOrderByWithRelationInput[]
    /**
     * {@link https://www.prisma.io/docs/concepts/components/prisma-client/pagination#cursor-based-pagination Cursor Docs}
     * 
     * Sets the position for listing skill_model_configs.
     */
    cursor?: skill_model_configsWhereUniqueInput
    /**
     * {@link https://www.prisma.io/docs/concepts/components/prisma-client/pagination Pagination Docs}
     * 
     * Take `±n` skill_model_configs from the position of the cursor.
     */
    take?: number
    /**
     * {@link https://www.prisma.io/docs/concepts/components/prisma-client/pagination Pagination Docs}
     * 
     * Skip the first `n` skill_model_configs.
     */
    skip?: number
    distinct?: Skill_model_configsScalarFieldEnum | Skill_model_configsScalarFieldEnum[]
  }

  /**
   * skill_model_configs create
   */
  export type skill_model_configsCreateArgs<ExtArgs extends $Extensions.InternalArgs = $Extensions.DefaultArgs> = {
    /**
     * Select specific fields to fetch from the skill_model_configs
     */
    select?: skill_model_configsSelect<ExtArgs> | null
    /**
     * The data needed to create a skill_model_configs.
     */
    data: XOR<skill_model_configsCreateInput, skill_model_configsUncheckedCreateInput>
  }

  /**
   * skill_model_configs createMany
   */
  export type skill_model_configsCreateManyArgs<ExtArgs extends $Extensions.InternalArgs = $Extensions.DefaultArgs> = {
    /**
     * The data used to create many skill_model_configs.
     */
    data: skill_model_configsCreateManyInput | skill_model_configsCreateManyInput[]
  }

  /**
   * skill_model_configs createManyAndReturn
   */
  export type skill_model_configsCreateManyAndReturnArgs<ExtArgs extends $Extensions.InternalArgs = $Extensions.DefaultArgs> = {
    /**
     * Select specific fields to fetch from the skill_model_configs
     */
    select?: skill_model_configsSelectCreateManyAndReturn<ExtArgs> | null
    /**
     * The data used to create many skill_model_configs.
     */
    data: skill_model_configsCreateManyInput | skill_model_configsCreateManyInput[]
  }

  /**
   * skill_model_configs update
   */
  export type skill_model_configsUpdateArgs<ExtArgs extends $Extensions.InternalArgs = $Extensions.DefaultArgs> = {
    /**
     * Select specific fields to fetch from the skill_model_configs
     */
    select?: skill_model_configsSelect<ExtArgs> | null
    /**
     * The data needed to update a skill_model_configs.
     */
    data: XOR<skill_model_configsUpdateInput, skill_model_configsUncheckedUpdateInput>
    /**
     * Choose, which skill_model_configs to update.
     */
    where: skill_model_configsWhereUniqueInput
  }

  /**
   * skill_model_configs updateMany
   */
  export type skill_model_configsUpdateManyArgs<ExtArgs extends $Extensions.InternalArgs = $Extensions.DefaultArgs> = {
    /**
     * The data used to update skill_model_configs.
     */
    data: XOR<skill_model_configsUpdateManyMutationInput, skill_model_configsUncheckedUpdateManyInput>
    /**
     * Filter which skill_model_configs to update
     */
    where?: skill_model_configsWhereInput
  }

  /**
   * skill_model_configs upsert
   */
  export type skill_model_configsUpsertArgs<ExtArgs extends $Extensions.InternalArgs = $Extensions.DefaultArgs> = {
    /**
     * Select specific fields to fetch from the skill_model_configs
     */
    select?: skill_model_configsSelect<ExtArgs> | null
    /**
     * The filter to search for the skill_model_configs to update in case it exists.
     */
    where: skill_model_configsWhereUniqueInput
    /**
     * In case the skill_model_configs found by the `where` argument doesn't exist, create a new skill_model_configs with this data.
     */
    create: XOR<skill_model_configsCreateInput, skill_model_configsUncheckedCreateInput>
    /**
     * In case the skill_model_configs was found with the provided `where` argument, update it with this data.
     */
    update: XOR<skill_model_configsUpdateInput, skill_model_configsUncheckedUpdateInput>
  }

  /**
   * skill_model_configs delete
   */
  export type skill_model_configsDeleteArgs<ExtArgs extends $Extensions.InternalArgs = $Extensions.DefaultArgs> = {
    /**
     * Select specific fields to fetch from the skill_model_configs
     */
    select?: skill_model_configsSelect<ExtArgs> | null
    /**
     * Filter which skill_model_configs to delete.
     */
    where: skill_model_configsWhereUniqueInput
  }

  /**
   * skill_model_configs deleteMany
   */
  export type skill_model_configsDeleteManyArgs<ExtArgs extends $Extensions.InternalArgs = $Extensions.DefaultArgs> = {
    /**
     * Filter which skill_model_configs to delete
     */
    where?: skill_model_configsWhereInput
  }

  /**
   * skill_model_configs without action
   */
  export type skill_model_configsDefaultArgs<ExtArgs extends $Extensions.InternalArgs = $Extensions.DefaultArgs> = {
    /**
     * Select specific fields to fetch from the skill_model_configs
     */
    select?: skill_model_configsSelect<ExtArgs> | null
  }


  /**
   * Model skill_registrations
   */

  export type AggregateSkill_registrations = {
    _count: Skill_registrationsCountAggregateOutputType | null
    _avg: Skill_registrationsAvgAggregateOutputType | null
    _sum: Skill_registrationsSumAggregateOutputType | null
    _min: Skill_registrationsMinAggregateOutputType | null
    _max: Skill_registrationsMaxAggregateOutputType | null
  }

  export type Skill_registrationsAvgAggregateOutputType = {
    callCount: number | null
    successRate: number | null
  }

  export type Skill_registrationsSumAggregateOutputType = {
    callCount: number | null
    successRate: number | null
  }

  export type Skill_registrationsMinAggregateOutputType = {
    id: string | null
    name: string | null
    version: string | null
    category: string | null
    description: string | null
    inputSchema: string | null
    outputSchema: string | null
    endpoint: string | null
    callCount: number | null
    successRate: number | null
    createdAt: Date | null
    updatedAt: Date | null
  }

  export type Skill_registrationsMaxAggregateOutputType = {
    id: string | null
    name: string | null
    version: string | null
    category: string | null
    description: string | null
    inputSchema: string | null
    outputSchema: string | null
    endpoint: string | null
    callCount: number | null
    successRate: number | null
    createdAt: Date | null
    updatedAt: Date | null
  }

  export type Skill_registrationsCountAggregateOutputType = {
    id: number
    name: number
    version: number
    category: number
    description: number
    inputSchema: number
    outputSchema: number
    endpoint: number
    callCount: number
    successRate: number
    createdAt: number
    updatedAt: number
    _all: number
  }


  export type Skill_registrationsAvgAggregateInputType = {
    callCount?: true
    successRate?: true
  }

  export type Skill_registrationsSumAggregateInputType = {
    callCount?: true
    successRate?: true
  }

  export type Skill_registrationsMinAggregateInputType = {
    id?: true
    name?: true
    version?: true
    category?: true
    description?: true
    inputSchema?: true
    outputSchema?: true
    endpoint?: true
    callCount?: true
    successRate?: true
    createdAt?: true
    updatedAt?: true
  }

  export type Skill_registrationsMaxAggregateInputType = {
    id?: true
    name?: true
    version?: true
    category?: true
    description?: true
    inputSchema?: true
    outputSchema?: true
    endpoint?: true
    callCount?: true
    successRate?: true
    createdAt?: true
    updatedAt?: true
  }

  export type Skill_registrationsCountAggregateInputType = {
    id?: true
    name?: true
    version?: true
    category?: true
    description?: true
    inputSchema?: true
    outputSchema?: true
    endpoint?: true
    callCount?: true
    successRate?: true
    createdAt?: true
    updatedAt?: true
    _all?: true
  }

  export type Skill_registrationsAggregateArgs<ExtArgs extends $Extensions.InternalArgs = $Extensions.DefaultArgs> = {
    /**
     * Filter which skill_registrations to aggregate.
     */
    where?: skill_registrationsWhereInput
    /**
     * {@link https://www.prisma.io/docs/concepts/components/prisma-client/sorting Sorting Docs}
     * 
     * Determine the order of skill_registrations to fetch.
     */
    orderBy?: skill_registrationsOrderByWithRelationInput | skill_registrationsOrderByWithRelationInput[]
    /**
     * {@link https://www.prisma.io/docs/concepts/components/prisma-client/pagination#cursor-based-pagination Cursor Docs}
     * 
     * Sets the start position
     */
    cursor?: skill_registrationsWhereUniqueInput
    /**
     * {@link https://www.prisma.io/docs/concepts/components/prisma-client/pagination Pagination Docs}
     * 
     * Take `±n` skill_registrations from the position of the cursor.
     */
    take?: number
    /**
     * {@link https://www.prisma.io/docs/concepts/components/prisma-client/pagination Pagination Docs}
     * 
     * Skip the first `n` skill_registrations.
     */
    skip?: number
    /**
     * {@link https://www.prisma.io/docs/concepts/components/prisma-client/aggregations Aggregation Docs}
     * 
     * Count returned skill_registrations
    **/
    _count?: true | Skill_registrationsCountAggregateInputType
    /**
     * {@link https://www.prisma.io/docs/concepts/components/prisma-client/aggregations Aggregation Docs}
     * 
     * Select which fields to average
    **/
    _avg?: Skill_registrationsAvgAggregateInputType
    /**
     * {@link https://www.prisma.io/docs/concepts/components/prisma-client/aggregations Aggregation Docs}
     * 
     * Select which fields to sum
    **/
    _sum?: Skill_registrationsSumAggregateInputType
    /**
     * {@link https://www.prisma.io/docs/concepts/components/prisma-client/aggregations Aggregation Docs}
     * 
     * Select which fields to find the minimum value
    **/
    _min?: Skill_registrationsMinAggregateInputType
    /**
     * {@link https://www.prisma.io/docs/concepts/components/prisma-client/aggregations Aggregation Docs}
     * 
     * Select which fields to find the maximum value
    **/
    _max?: Skill_registrationsMaxAggregateInputType
  }

  export type GetSkill_registrationsAggregateType<T extends Skill_registrationsAggregateArgs> = {
        [P in keyof T & keyof AggregateSkill_registrations]: P extends '_count' | 'count'
      ? T[P] extends true
        ? number
        : GetScalarType<T[P], AggregateSkill_registrations[P]>
      : GetScalarType<T[P], AggregateSkill_registrations[P]>
  }




  export type skill_registrationsGroupByArgs<ExtArgs extends $Extensions.InternalArgs = $Extensions.DefaultArgs> = {
    where?: skill_registrationsWhereInput
    orderBy?: skill_registrationsOrderByWithAggregationInput | skill_registrationsOrderByWithAggregationInput[]
    by: Skill_registrationsScalarFieldEnum[] | Skill_registrationsScalarFieldEnum
    having?: skill_registrationsScalarWhereWithAggregatesInput
    take?: number
    skip?: number
    _count?: Skill_registrationsCountAggregateInputType | true
    _avg?: Skill_registrationsAvgAggregateInputType
    _sum?: Skill_registrationsSumAggregateInputType
    _min?: Skill_registrationsMinAggregateInputType
    _max?: Skill_registrationsMaxAggregateInputType
  }

  export type Skill_registrationsGroupByOutputType = {
    id: string
    name: string
    version: string
    category: string | null
    description: string | null
    inputSchema: string | null
    outputSchema: string | null
    endpoint: string | null
    callCount: number
    successRate: number
    createdAt: Date
    updatedAt: Date
    _count: Skill_registrationsCountAggregateOutputType | null
    _avg: Skill_registrationsAvgAggregateOutputType | null
    _sum: Skill_registrationsSumAggregateOutputType | null
    _min: Skill_registrationsMinAggregateOutputType | null
    _max: Skill_registrationsMaxAggregateOutputType | null
  }

  type GetSkill_registrationsGroupByPayload<T extends skill_registrationsGroupByArgs> = Prisma.PrismaPromise<
    Array<
      PickEnumerable<Skill_registrationsGroupByOutputType, T['by']> &
        {
          [P in ((keyof T) & (keyof Skill_registrationsGroupByOutputType))]: P extends '_count'
            ? T[P] extends boolean
              ? number
              : GetScalarType<T[P], Skill_registrationsGroupByOutputType[P]>
            : GetScalarType<T[P], Skill_registrationsGroupByOutputType[P]>
        }
      >
    >


  export type skill_registrationsSelect<ExtArgs extends $Extensions.InternalArgs = $Extensions.DefaultArgs> = $Extensions.GetSelect<{
    id?: boolean
    name?: boolean
    version?: boolean
    category?: boolean
    description?: boolean
    inputSchema?: boolean
    outputSchema?: boolean
    endpoint?: boolean
    callCount?: boolean
    successRate?: boolean
    createdAt?: boolean
    updatedAt?: boolean
  }, ExtArgs["result"]["skill_registrations"]>

  export type skill_registrationsSelectCreateManyAndReturn<ExtArgs extends $Extensions.InternalArgs = $Extensions.DefaultArgs> = $Extensions.GetSelect<{
    id?: boolean
    name?: boolean
    version?: boolean
    category?: boolean
    description?: boolean
    inputSchema?: boolean
    outputSchema?: boolean
    endpoint?: boolean
    callCount?: boolean
    successRate?: boolean
    createdAt?: boolean
    updatedAt?: boolean
  }, ExtArgs["result"]["skill_registrations"]>

  export type skill_registrationsSelectScalar = {
    id?: boolean
    name?: boolean
    version?: boolean
    category?: boolean
    description?: boolean
    inputSchema?: boolean
    outputSchema?: boolean
    endpoint?: boolean
    callCount?: boolean
    successRate?: boolean
    createdAt?: boolean
    updatedAt?: boolean
  }


  export type $skill_registrationsPayload<ExtArgs extends $Extensions.InternalArgs = $Extensions.DefaultArgs> = {
    name: "skill_registrations"
    objects: {}
    scalars: $Extensions.GetPayloadResult<{
      id: string
      name: string
      version: string
      category: string | null
      description: string | null
      inputSchema: string | null
      outputSchema: string | null
      endpoint: string | null
      callCount: number
      successRate: number
      createdAt: Date
      updatedAt: Date
    }, ExtArgs["result"]["skill_registrations"]>
    composites: {}
  }

  type skill_registrationsGetPayload<S extends boolean | null | undefined | skill_registrationsDefaultArgs> = $Result.GetResult<Prisma.$skill_registrationsPayload, S>

  type skill_registrationsCountArgs<ExtArgs extends $Extensions.InternalArgs = $Extensions.DefaultArgs> = 
    Omit<skill_registrationsFindManyArgs, 'select' | 'include' | 'distinct'> & {
      select?: Skill_registrationsCountAggregateInputType | true
    }

  export interface skill_registrationsDelegate<ExtArgs extends $Extensions.InternalArgs = $Extensions.DefaultArgs> {
    [K: symbol]: { types: Prisma.TypeMap<ExtArgs>['model']['skill_registrations'], meta: { name: 'skill_registrations' } }
    /**
     * Find zero or one Skill_registrations that matches the filter.
     * @param {skill_registrationsFindUniqueArgs} args - Arguments to find a Skill_registrations
     * @example
     * // Get one Skill_registrations
     * const skill_registrations = await prisma.skill_registrations.findUnique({
     *   where: {
     *     // ... provide filter here
     *   }
     * })
     */
    findUnique<T extends skill_registrationsFindUniqueArgs>(args: SelectSubset<T, skill_registrationsFindUniqueArgs<ExtArgs>>): Prisma__skill_registrationsClient<$Result.GetResult<Prisma.$skill_registrationsPayload<ExtArgs>, T, "findUnique"> | null, null, ExtArgs>

    /**
     * Find one Skill_registrations that matches the filter or throw an error with `error.code='P2025'` 
     * if no matches were found.
     * @param {skill_registrationsFindUniqueOrThrowArgs} args - Arguments to find a Skill_registrations
     * @example
     * // Get one Skill_registrations
     * const skill_registrations = await prisma.skill_registrations.findUniqueOrThrow({
     *   where: {
     *     // ... provide filter here
     *   }
     * })
     */
    findUniqueOrThrow<T extends skill_registrationsFindUniqueOrThrowArgs>(args: SelectSubset<T, skill_registrationsFindUniqueOrThrowArgs<ExtArgs>>): Prisma__skill_registrationsClient<$Result.GetResult<Prisma.$skill_registrationsPayload<ExtArgs>, T, "findUniqueOrThrow">, never, ExtArgs>

    /**
     * Find the first Skill_registrations that matches the filter.
     * Note, that providing `undefined` is treated as the value not being there.
     * Read more here: https://pris.ly/d/null-undefined
     * @param {skill_registrationsFindFirstArgs} args - Arguments to find a Skill_registrations
     * @example
     * // Get one Skill_registrations
     * const skill_registrations = await prisma.skill_registrations.findFirst({
     *   where: {
     *     // ... provide filter here
     *   }
     * })
     */
    findFirst<T extends skill_registrationsFindFirstArgs>(args?: SelectSubset<T, skill_registrationsFindFirstArgs<ExtArgs>>): Prisma__skill_registrationsClient<$Result.GetResult<Prisma.$skill_registrationsPayload<ExtArgs>, T, "findFirst"> | null, null, ExtArgs>

    /**
     * Find the first Skill_registrations that matches the filter or
     * throw `PrismaKnownClientError` with `P2025` code if no matches were found.
     * Note, that providing `undefined` is treated as the value not being there.
     * Read more here: https://pris.ly/d/null-undefined
     * @param {skill_registrationsFindFirstOrThrowArgs} args - Arguments to find a Skill_registrations
     * @example
     * // Get one Skill_registrations
     * const skill_registrations = await prisma.skill_registrations.findFirstOrThrow({
     *   where: {
     *     // ... provide filter here
     *   }
     * })
     */
    findFirstOrThrow<T extends skill_registrationsFindFirstOrThrowArgs>(args?: SelectSubset<T, skill_registrationsFindFirstOrThrowArgs<ExtArgs>>): Prisma__skill_registrationsClient<$Result.GetResult<Prisma.$skill_registrationsPayload<ExtArgs>, T, "findFirstOrThrow">, never, ExtArgs>

    /**
     * Find zero or more Skill_registrations that matches the filter.
     * Note, that providing `undefined` is treated as the value not being there.
     * Read more here: https://pris.ly/d/null-undefined
     * @param {skill_registrationsFindManyArgs} args - Arguments to filter and select certain fields only.
     * @example
     * // Get all Skill_registrations
     * const skill_registrations = await prisma.skill_registrations.findMany()
     * 
     * // Get first 10 Skill_registrations
     * const skill_registrations = await prisma.skill_registrations.findMany({ take: 10 })
     * 
     * // Only select the `id`
     * const skill_registrationsWithIdOnly = await prisma.skill_registrations.findMany({ select: { id: true } })
     * 
     */
    findMany<T extends skill_registrationsFindManyArgs>(args?: SelectSubset<T, skill_registrationsFindManyArgs<ExtArgs>>): Prisma.PrismaPromise<$Result.GetResult<Prisma.$skill_registrationsPayload<ExtArgs>, T, "findMany">>

    /**
     * Create a Skill_registrations.
     * @param {skill_registrationsCreateArgs} args - Arguments to create a Skill_registrations.
     * @example
     * // Create one Skill_registrations
     * const Skill_registrations = await prisma.skill_registrations.create({
     *   data: {
     *     // ... data to create a Skill_registrations
     *   }
     * })
     * 
     */
    create<T extends skill_registrationsCreateArgs>(args: SelectSubset<T, skill_registrationsCreateArgs<ExtArgs>>): Prisma__skill_registrationsClient<$Result.GetResult<Prisma.$skill_registrationsPayload<ExtArgs>, T, "create">, never, ExtArgs>

    /**
     * Create many Skill_registrations.
     * @param {skill_registrationsCreateManyArgs} args - Arguments to create many Skill_registrations.
     * @example
     * // Create many Skill_registrations
     * const skill_registrations = await prisma.skill_registrations.createMany({
     *   data: [
     *     // ... provide data here
     *   ]
     * })
     *     
     */
    createMany<T extends skill_registrationsCreateManyArgs>(args?: SelectSubset<T, skill_registrationsCreateManyArgs<ExtArgs>>): Prisma.PrismaPromise<BatchPayload>

    /**
     * Create many Skill_registrations and returns the data saved in the database.
     * @param {skill_registrationsCreateManyAndReturnArgs} args - Arguments to create many Skill_registrations.
     * @example
     * // Create many Skill_registrations
     * const skill_registrations = await prisma.skill_registrations.createManyAndReturn({
     *   data: [
     *     // ... provide data here
     *   ]
     * })
     * 
     * // Create many Skill_registrations and only return the `id`
     * const skill_registrationsWithIdOnly = await prisma.skill_registrations.createManyAndReturn({ 
     *   select: { id: true },
     *   data: [
     *     // ... provide data here
     *   ]
     * })
     * Note, that providing `undefined` is treated as the value not being there.
     * Read more here: https://pris.ly/d/null-undefined
     * 
     */
    createManyAndReturn<T extends skill_registrationsCreateManyAndReturnArgs>(args?: SelectSubset<T, skill_registrationsCreateManyAndReturnArgs<ExtArgs>>): Prisma.PrismaPromise<$Result.GetResult<Prisma.$skill_registrationsPayload<ExtArgs>, T, "createManyAndReturn">>

    /**
     * Delete a Skill_registrations.
     * @param {skill_registrationsDeleteArgs} args - Arguments to delete one Skill_registrations.
     * @example
     * // Delete one Skill_registrations
     * const Skill_registrations = await prisma.skill_registrations.delete({
     *   where: {
     *     // ... filter to delete one Skill_registrations
     *   }
     * })
     * 
     */
    delete<T extends skill_registrationsDeleteArgs>(args: SelectSubset<T, skill_registrationsDeleteArgs<ExtArgs>>): Prisma__skill_registrationsClient<$Result.GetResult<Prisma.$skill_registrationsPayload<ExtArgs>, T, "delete">, never, ExtArgs>

    /**
     * Update one Skill_registrations.
     * @param {skill_registrationsUpdateArgs} args - Arguments to update one Skill_registrations.
     * @example
     * // Update one Skill_registrations
     * const skill_registrations = await prisma.skill_registrations.update({
     *   where: {
     *     // ... provide filter here
     *   },
     *   data: {
     *     // ... provide data here
     *   }
     * })
     * 
     */
    update<T extends skill_registrationsUpdateArgs>(args: SelectSubset<T, skill_registrationsUpdateArgs<ExtArgs>>): Prisma__skill_registrationsClient<$Result.GetResult<Prisma.$skill_registrationsPayload<ExtArgs>, T, "update">, never, ExtArgs>

    /**
     * Delete zero or more Skill_registrations.
     * @param {skill_registrationsDeleteManyArgs} args - Arguments to filter Skill_registrations to delete.
     * @example
     * // Delete a few Skill_registrations
     * const { count } = await prisma.skill_registrations.deleteMany({
     *   where: {
     *     // ... provide filter here
     *   }
     * })
     * 
     */
    deleteMany<T extends skill_registrationsDeleteManyArgs>(args?: SelectSubset<T, skill_registrationsDeleteManyArgs<ExtArgs>>): Prisma.PrismaPromise<BatchPayload>

    /**
     * Update zero or more Skill_registrations.
     * Note, that providing `undefined` is treated as the value not being there.
     * Read more here: https://pris.ly/d/null-undefined
     * @param {skill_registrationsUpdateManyArgs} args - Arguments to update one or more rows.
     * @example
     * // Update many Skill_registrations
     * const skill_registrations = await prisma.skill_registrations.updateMany({
     *   where: {
     *     // ... provide filter here
     *   },
     *   data: {
     *     // ... provide data here
     *   }
     * })
     * 
     */
    updateMany<T extends skill_registrationsUpdateManyArgs>(args: SelectSubset<T, skill_registrationsUpdateManyArgs<ExtArgs>>): Prisma.PrismaPromise<BatchPayload>

    /**
     * Create or update one Skill_registrations.
     * @param {skill_registrationsUpsertArgs} args - Arguments to update or create a Skill_registrations.
     * @example
     * // Update or create a Skill_registrations
     * const skill_registrations = await prisma.skill_registrations.upsert({
     *   create: {
     *     // ... data to create a Skill_registrations
     *   },
     *   update: {
     *     // ... in case it already exists, update
     *   },
     *   where: {
     *     // ... the filter for the Skill_registrations we want to update
     *   }
     * })
     */
    upsert<T extends skill_registrationsUpsertArgs>(args: SelectSubset<T, skill_registrationsUpsertArgs<ExtArgs>>): Prisma__skill_registrationsClient<$Result.GetResult<Prisma.$skill_registrationsPayload<ExtArgs>, T, "upsert">, never, ExtArgs>


    /**
     * Count the number of Skill_registrations.
     * Note, that providing `undefined` is treated as the value not being there.
     * Read more here: https://pris.ly/d/null-undefined
     * @param {skill_registrationsCountArgs} args - Arguments to filter Skill_registrations to count.
     * @example
     * // Count the number of Skill_registrations
     * const count = await prisma.skill_registrations.count({
     *   where: {
     *     // ... the filter for the Skill_registrations we want to count
     *   }
     * })
    **/
    count<T extends skill_registrationsCountArgs>(
      args?: Subset<T, skill_registrationsCountArgs>,
    ): Prisma.PrismaPromise<
      T extends $Utils.Record<'select', any>
        ? T['select'] extends true
          ? number
          : GetScalarType<T['select'], Skill_registrationsCountAggregateOutputType>
        : number
    >

    /**
     * Allows you to perform aggregations operations on a Skill_registrations.
     * Note, that providing `undefined` is treated as the value not being there.
     * Read more here: https://pris.ly/d/null-undefined
     * @param {Skill_registrationsAggregateArgs} args - Select which aggregations you would like to apply and on what fields.
     * @example
     * // Ordered by age ascending
     * // Where email contains prisma.io
     * // Limited to the 10 users
     * const aggregations = await prisma.user.aggregate({
     *   _avg: {
     *     age: true,
     *   },
     *   where: {
     *     email: {
     *       contains: "prisma.io",
     *     },
     *   },
     *   orderBy: {
     *     age: "asc",
     *   },
     *   take: 10,
     * })
    **/
    aggregate<T extends Skill_registrationsAggregateArgs>(args: Subset<T, Skill_registrationsAggregateArgs>): Prisma.PrismaPromise<GetSkill_registrationsAggregateType<T>>

    /**
     * Group by Skill_registrations.
     * Note, that providing `undefined` is treated as the value not being there.
     * Read more here: https://pris.ly/d/null-undefined
     * @param {skill_registrationsGroupByArgs} args - Group by arguments.
     * @example
     * // Group by city, order by createdAt, get count
     * const result = await prisma.user.groupBy({
     *   by: ['city', 'createdAt'],
     *   orderBy: {
     *     createdAt: true
     *   },
     *   _count: {
     *     _all: true
     *   },
     * })
     * 
    **/
    groupBy<
      T extends skill_registrationsGroupByArgs,
      HasSelectOrTake extends Or<
        Extends<'skip', Keys<T>>,
        Extends<'take', Keys<T>>
      >,
      OrderByArg extends True extends HasSelectOrTake
        ? { orderBy: skill_registrationsGroupByArgs['orderBy'] }
        : { orderBy?: skill_registrationsGroupByArgs['orderBy'] },
      OrderFields extends ExcludeUnderscoreKeys<Keys<MaybeTupleToUnion<T['orderBy']>>>,
      ByFields extends MaybeTupleToUnion<T['by']>,
      ByValid extends Has<ByFields, OrderFields>,
      HavingFields extends GetHavingFields<T['having']>,
      HavingValid extends Has<ByFields, HavingFields>,
      ByEmpty extends T['by'] extends never[] ? True : False,
      InputErrors extends ByEmpty extends True
      ? `Error: "by" must not be empty.`
      : HavingValid extends False
      ? {
          [P in HavingFields]: P extends ByFields
            ? never
            : P extends string
            ? `Error: Field "${P}" used in "having" needs to be provided in "by".`
            : [
                Error,
                'Field ',
                P,
                ` in "having" needs to be provided in "by"`,
              ]
        }[HavingFields]
      : 'take' extends Keys<T>
      ? 'orderBy' extends Keys<T>
        ? ByValid extends True
          ? {}
          : {
              [P in OrderFields]: P extends ByFields
                ? never
                : `Error: Field "${P}" in "orderBy" needs to be provided in "by"`
            }[OrderFields]
        : 'Error: If you provide "take", you also need to provide "orderBy"'
      : 'skip' extends Keys<T>
      ? 'orderBy' extends Keys<T>
        ? ByValid extends True
          ? {}
          : {
              [P in OrderFields]: P extends ByFields
                ? never
                : `Error: Field "${P}" in "orderBy" needs to be provided in "by"`
            }[OrderFields]
        : 'Error: If you provide "skip", you also need to provide "orderBy"'
      : ByValid extends True
      ? {}
      : {
          [P in OrderFields]: P extends ByFields
            ? never
            : `Error: Field "${P}" in "orderBy" needs to be provided in "by"`
        }[OrderFields]
    >(args: SubsetIntersection<T, skill_registrationsGroupByArgs, OrderByArg> & InputErrors): {} extends InputErrors ? GetSkill_registrationsGroupByPayload<T> : Prisma.PrismaPromise<InputErrors>
  /**
   * Fields of the skill_registrations model
   */
  readonly fields: skill_registrationsFieldRefs;
  }

  /**
   * The delegate class that acts as a "Promise-like" for skill_registrations.
   * Why is this prefixed with `Prisma__`?
   * Because we want to prevent naming conflicts as mentioned in
   * https://github.com/prisma/prisma-client-js/issues/707
   */
  export interface Prisma__skill_registrationsClient<T, Null = never, ExtArgs extends $Extensions.InternalArgs = $Extensions.DefaultArgs> extends Prisma.PrismaPromise<T> {
    readonly [Symbol.toStringTag]: "PrismaPromise"
    /**
     * Attaches callbacks for the resolution and/or rejection of the Promise.
     * @param onfulfilled The callback to execute when the Promise is resolved.
     * @param onrejected The callback to execute when the Promise is rejected.
     * @returns A Promise for the completion of which ever callback is executed.
     */
    then<TResult1 = T, TResult2 = never>(onfulfilled?: ((value: T) => TResult1 | PromiseLike<TResult1>) | undefined | null, onrejected?: ((reason: any) => TResult2 | PromiseLike<TResult2>) | undefined | null): $Utils.JsPromise<TResult1 | TResult2>
    /**
     * Attaches a callback for only the rejection of the Promise.
     * @param onrejected The callback to execute when the Promise is rejected.
     * @returns A Promise for the completion of the callback.
     */
    catch<TResult = never>(onrejected?: ((reason: any) => TResult | PromiseLike<TResult>) | undefined | null): $Utils.JsPromise<T | TResult>
    /**
     * Attaches a callback that is invoked when the Promise is settled (fulfilled or rejected). The
     * resolved value cannot be modified from the callback.
     * @param onfinally The callback to execute when the Promise is settled (fulfilled or rejected).
     * @returns A Promise for the completion of the callback.
     */
    finally(onfinally?: (() => void) | undefined | null): $Utils.JsPromise<T>
  }




  /**
   * Fields of the skill_registrations model
   */ 
  interface skill_registrationsFieldRefs {
    readonly id: FieldRef<"skill_registrations", 'String'>
    readonly name: FieldRef<"skill_registrations", 'String'>
    readonly version: FieldRef<"skill_registrations", 'String'>
    readonly category: FieldRef<"skill_registrations", 'String'>
    readonly description: FieldRef<"skill_registrations", 'String'>
    readonly inputSchema: FieldRef<"skill_registrations", 'String'>
    readonly outputSchema: FieldRef<"skill_registrations", 'String'>
    readonly endpoint: FieldRef<"skill_registrations", 'String'>
    readonly callCount: FieldRef<"skill_registrations", 'Int'>
    readonly successRate: FieldRef<"skill_registrations", 'Float'>
    readonly createdAt: FieldRef<"skill_registrations", 'DateTime'>
    readonly updatedAt: FieldRef<"skill_registrations", 'DateTime'>
  }
    

  // Custom InputTypes
  /**
   * skill_registrations findUnique
   */
  export type skill_registrationsFindUniqueArgs<ExtArgs extends $Extensions.InternalArgs = $Extensions.DefaultArgs> = {
    /**
     * Select specific fields to fetch from the skill_registrations
     */
    select?: skill_registrationsSelect<ExtArgs> | null
    /**
     * Filter, which skill_registrations to fetch.
     */
    where: skill_registrationsWhereUniqueInput
  }

  /**
   * skill_registrations findUniqueOrThrow
   */
  export type skill_registrationsFindUniqueOrThrowArgs<ExtArgs extends $Extensions.InternalArgs = $Extensions.DefaultArgs> = {
    /**
     * Select specific fields to fetch from the skill_registrations
     */
    select?: skill_registrationsSelect<ExtArgs> | null
    /**
     * Filter, which skill_registrations to fetch.
     */
    where: skill_registrationsWhereUniqueInput
  }

  /**
   * skill_registrations findFirst
   */
  export type skill_registrationsFindFirstArgs<ExtArgs extends $Extensions.InternalArgs = $Extensions.DefaultArgs> = {
    /**
     * Select specific fields to fetch from the skill_registrations
     */
    select?: skill_registrationsSelect<ExtArgs> | null
    /**
     * Filter, which skill_registrations to fetch.
     */
    where?: skill_registrationsWhereInput
    /**
     * {@link https://www.prisma.io/docs/concepts/components/prisma-client/sorting Sorting Docs}
     * 
     * Determine the order of skill_registrations to fetch.
     */
    orderBy?: skill_registrationsOrderByWithRelationInput | skill_registrationsOrderByWithRelationInput[]
    /**
     * {@link https://www.prisma.io/docs/concepts/components/prisma-client/pagination#cursor-based-pagination Cursor Docs}
     * 
     * Sets the position for searching for skill_registrations.
     */
    cursor?: skill_registrationsWhereUniqueInput
    /**
     * {@link https://www.prisma.io/docs/concepts/components/prisma-client/pagination Pagination Docs}
     * 
     * Take `±n` skill_registrations from the position of the cursor.
     */
    take?: number
    /**
     * {@link https://www.prisma.io/docs/concepts/components/prisma-client/pagination Pagination Docs}
     * 
     * Skip the first `n` skill_registrations.
     */
    skip?: number
    /**
     * {@link https://www.prisma.io/docs/concepts/components/prisma-client/distinct Distinct Docs}
     * 
     * Filter by unique combinations of skill_registrations.
     */
    distinct?: Skill_registrationsScalarFieldEnum | Skill_registrationsScalarFieldEnum[]
  }

  /**
   * skill_registrations findFirstOrThrow
   */
  export type skill_registrationsFindFirstOrThrowArgs<ExtArgs extends $Extensions.InternalArgs = $Extensions.DefaultArgs> = {
    /**
     * Select specific fields to fetch from the skill_registrations
     */
    select?: skill_registrationsSelect<ExtArgs> | null
    /**
     * Filter, which skill_registrations to fetch.
     */
    where?: skill_registrationsWhereInput
    /**
     * {@link https://www.prisma.io/docs/concepts/components/prisma-client/sorting Sorting Docs}
     * 
     * Determine the order of skill_registrations to fetch.
     */
    orderBy?: skill_registrationsOrderByWithRelationInput | skill_registrationsOrderByWithRelationInput[]
    /**
     * {@link https://www.prisma.io/docs/concepts/components/prisma-client/pagination#cursor-based-pagination Cursor Docs}
     * 
     * Sets the position for searching for skill_registrations.
     */
    cursor?: skill_registrationsWhereUniqueInput
    /**
     * {@link https://www.prisma.io/docs/concepts/components/prisma-client/pagination Pagination Docs}
     * 
     * Take `±n` skill_registrations from the position of the cursor.
     */
    take?: number
    /**
     * {@link https://www.prisma.io/docs/concepts/components/prisma-client/pagination Pagination Docs}
     * 
     * Skip the first `n` skill_registrations.
     */
    skip?: number
    /**
     * {@link https://www.prisma.io/docs/concepts/components/prisma-client/distinct Distinct Docs}
     * 
     * Filter by unique combinations of skill_registrations.
     */
    distinct?: Skill_registrationsScalarFieldEnum | Skill_registrationsScalarFieldEnum[]
  }

  /**
   * skill_registrations findMany
   */
  export type skill_registrationsFindManyArgs<ExtArgs extends $Extensions.InternalArgs = $Extensions.DefaultArgs> = {
    /**
     * Select specific fields to fetch from the skill_registrations
     */
    select?: skill_registrationsSelect<ExtArgs> | null
    /**
     * Filter, which skill_registrations to fetch.
     */
    where?: skill_registrationsWhereInput
    /**
     * {@link https://www.prisma.io/docs/concepts/components/prisma-client/sorting Sorting Docs}
     * 
     * Determine the order of skill_registrations to fetch.
     */
    orderBy?: skill_registrationsOrderByWithRelationInput | skill_registrationsOrderByWithRelationInput[]
    /**
     * {@link https://www.prisma.io/docs/concepts/components/prisma-client/pagination#cursor-based-pagination Cursor Docs}
     * 
     * Sets the position for listing skill_registrations.
     */
    cursor?: skill_registrationsWhereUniqueInput
    /**
     * {@link https://www.prisma.io/docs/concepts/components/prisma-client/pagination Pagination Docs}
     * 
     * Take `±n` skill_registrations from the position of the cursor.
     */
    take?: number
    /**
     * {@link https://www.prisma.io/docs/concepts/components/prisma-client/pagination Pagination Docs}
     * 
     * Skip the first `n` skill_registrations.
     */
    skip?: number
    distinct?: Skill_registrationsScalarFieldEnum | Skill_registrationsScalarFieldEnum[]
  }

  /**
   * skill_registrations create
   */
  export type skill_registrationsCreateArgs<ExtArgs extends $Extensions.InternalArgs = $Extensions.DefaultArgs> = {
    /**
     * Select specific fields to fetch from the skill_registrations
     */
    select?: skill_registrationsSelect<ExtArgs> | null
    /**
     * The data needed to create a skill_registrations.
     */
    data: XOR<skill_registrationsCreateInput, skill_registrationsUncheckedCreateInput>
  }

  /**
   * skill_registrations createMany
   */
  export type skill_registrationsCreateManyArgs<ExtArgs extends $Extensions.InternalArgs = $Extensions.DefaultArgs> = {
    /**
     * The data used to create many skill_registrations.
     */
    data: skill_registrationsCreateManyInput | skill_registrationsCreateManyInput[]
  }

  /**
   * skill_registrations createManyAndReturn
   */
  export type skill_registrationsCreateManyAndReturnArgs<ExtArgs extends $Extensions.InternalArgs = $Extensions.DefaultArgs> = {
    /**
     * Select specific fields to fetch from the skill_registrations
     */
    select?: skill_registrationsSelectCreateManyAndReturn<ExtArgs> | null
    /**
     * The data used to create many skill_registrations.
     */
    data: skill_registrationsCreateManyInput | skill_registrationsCreateManyInput[]
  }

  /**
   * skill_registrations update
   */
  export type skill_registrationsUpdateArgs<ExtArgs extends $Extensions.InternalArgs = $Extensions.DefaultArgs> = {
    /**
     * Select specific fields to fetch from the skill_registrations
     */
    select?: skill_registrationsSelect<ExtArgs> | null
    /**
     * The data needed to update a skill_registrations.
     */
    data: XOR<skill_registrationsUpdateInput, skill_registrationsUncheckedUpdateInput>
    /**
     * Choose, which skill_registrations to update.
     */
    where: skill_registrationsWhereUniqueInput
  }

  /**
   * skill_registrations updateMany
   */
  export type skill_registrationsUpdateManyArgs<ExtArgs extends $Extensions.InternalArgs = $Extensions.DefaultArgs> = {
    /**
     * The data used to update skill_registrations.
     */
    data: XOR<skill_registrationsUpdateManyMutationInput, skill_registrationsUncheckedUpdateManyInput>
    /**
     * Filter which skill_registrations to update
     */
    where?: skill_registrationsWhereInput
  }

  /**
   * skill_registrations upsert
   */
  export type skill_registrationsUpsertArgs<ExtArgs extends $Extensions.InternalArgs = $Extensions.DefaultArgs> = {
    /**
     * Select specific fields to fetch from the skill_registrations
     */
    select?: skill_registrationsSelect<ExtArgs> | null
    /**
     * The filter to search for the skill_registrations to update in case it exists.
     */
    where: skill_registrationsWhereUniqueInput
    /**
     * In case the skill_registrations found by the `where` argument doesn't exist, create a new skill_registrations with this data.
     */
    create: XOR<skill_registrationsCreateInput, skill_registrationsUncheckedCreateInput>
    /**
     * In case the skill_registrations was found with the provided `where` argument, update it with this data.
     */
    update: XOR<skill_registrationsUpdateInput, skill_registrationsUncheckedUpdateInput>
  }

  /**
   * skill_registrations delete
   */
  export type skill_registrationsDeleteArgs<ExtArgs extends $Extensions.InternalArgs = $Extensions.DefaultArgs> = {
    /**
     * Select specific fields to fetch from the skill_registrations
     */
    select?: skill_registrationsSelect<ExtArgs> | null
    /**
     * Filter which skill_registrations to delete.
     */
    where: skill_registrationsWhereUniqueInput
  }

  /**
   * skill_registrations deleteMany
   */
  export type skill_registrationsDeleteManyArgs<ExtArgs extends $Extensions.InternalArgs = $Extensions.DefaultArgs> = {
    /**
     * Filter which skill_registrations to delete
     */
    where?: skill_registrationsWhereInput
  }

  /**
   * skill_registrations without action
   */
  export type skill_registrationsDefaultArgs<ExtArgs extends $Extensions.InternalArgs = $Extensions.DefaultArgs> = {
    /**
     * Select specific fields to fetch from the skill_registrations
     */
    select?: skill_registrationsSelect<ExtArgs> | null
  }


  /**
   * Model field_definitions
   */

  export type AggregateField_definitions = {
    _count: Field_definitionsCountAggregateOutputType | null
    _min: Field_definitionsMinAggregateOutputType | null
    _max: Field_definitionsMaxAggregateOutputType | null
  }

  export type Field_definitionsMinAggregateOutputType = {
    id: string | null
    fieldId: string | null
    stage: string | null
    promptRole: string | null
    valueType: string | null
    snakeName: string | null
    camelName: string | null
    description: string | null
    enumValues: string | null
    schemaVersion: string | null
    source: string | null
    managedByCode: boolean | null
    systemLocked: boolean | null
    structureLocked: boolean | null
    bindings: string | null
    metadata: string | null
    createdAt: Date | null
    updatedAt: Date | null
  }

  export type Field_definitionsMaxAggregateOutputType = {
    id: string | null
    fieldId: string | null
    stage: string | null
    promptRole: string | null
    valueType: string | null
    snakeName: string | null
    camelName: string | null
    description: string | null
    enumValues: string | null
    schemaVersion: string | null
    source: string | null
    managedByCode: boolean | null
    systemLocked: boolean | null
    structureLocked: boolean | null
    bindings: string | null
    metadata: string | null
    createdAt: Date | null
    updatedAt: Date | null
  }

  export type Field_definitionsCountAggregateOutputType = {
    id: number
    fieldId: number
    stage: number
    promptRole: number
    valueType: number
    snakeName: number
    camelName: number
    description: number
    enumValues: number
    schemaVersion: number
    source: number
    managedByCode: number
    systemLocked: number
    structureLocked: number
    bindings: number
    metadata: number
    createdAt: number
    updatedAt: number
    _all: number
  }


  export type Field_definitionsMinAggregateInputType = {
    id?: true
    fieldId?: true
    stage?: true
    promptRole?: true
    valueType?: true
    snakeName?: true
    camelName?: true
    description?: true
    enumValues?: true
    schemaVersion?: true
    source?: true
    managedByCode?: true
    systemLocked?: true
    structureLocked?: true
    bindings?: true
    metadata?: true
    createdAt?: true
    updatedAt?: true
  }

  export type Field_definitionsMaxAggregateInputType = {
    id?: true
    fieldId?: true
    stage?: true
    promptRole?: true
    valueType?: true
    snakeName?: true
    camelName?: true
    description?: true
    enumValues?: true
    schemaVersion?: true
    source?: true
    managedByCode?: true
    systemLocked?: true
    structureLocked?: true
    bindings?: true
    metadata?: true
    createdAt?: true
    updatedAt?: true
  }

  export type Field_definitionsCountAggregateInputType = {
    id?: true
    fieldId?: true
    stage?: true
    promptRole?: true
    valueType?: true
    snakeName?: true
    camelName?: true
    description?: true
    enumValues?: true
    schemaVersion?: true
    source?: true
    managedByCode?: true
    systemLocked?: true
    structureLocked?: true
    bindings?: true
    metadata?: true
    createdAt?: true
    updatedAt?: true
    _all?: true
  }

  export type Field_definitionsAggregateArgs<ExtArgs extends $Extensions.InternalArgs = $Extensions.DefaultArgs> = {
    /**
     * Filter which field_definitions to aggregate.
     */
    where?: field_definitionsWhereInput
    /**
     * {@link https://www.prisma.io/docs/concepts/components/prisma-client/sorting Sorting Docs}
     * 
     * Determine the order of field_definitions to fetch.
     */
    orderBy?: field_definitionsOrderByWithRelationInput | field_definitionsOrderByWithRelationInput[]
    /**
     * {@link https://www.prisma.io/docs/concepts/components/prisma-client/pagination#cursor-based-pagination Cursor Docs}
     * 
     * Sets the start position
     */
    cursor?: field_definitionsWhereUniqueInput
    /**
     * {@link https://www.prisma.io/docs/concepts/components/prisma-client/pagination Pagination Docs}
     * 
     * Take `±n` field_definitions from the position of the cursor.
     */
    take?: number
    /**
     * {@link https://www.prisma.io/docs/concepts/components/prisma-client/pagination Pagination Docs}
     * 
     * Skip the first `n` field_definitions.
     */
    skip?: number
    /**
     * {@link https://www.prisma.io/docs/concepts/components/prisma-client/aggregations Aggregation Docs}
     * 
     * Count returned field_definitions
    **/
    _count?: true | Field_definitionsCountAggregateInputType
    /**
     * {@link https://www.prisma.io/docs/concepts/components/prisma-client/aggregations Aggregation Docs}
     * 
     * Select which fields to find the minimum value
    **/
    _min?: Field_definitionsMinAggregateInputType
    /**
     * {@link https://www.prisma.io/docs/concepts/components/prisma-client/aggregations Aggregation Docs}
     * 
     * Select which fields to find the maximum value
    **/
    _max?: Field_definitionsMaxAggregateInputType
  }

  export type GetField_definitionsAggregateType<T extends Field_definitionsAggregateArgs> = {
        [P in keyof T & keyof AggregateField_definitions]: P extends '_count' | 'count'
      ? T[P] extends true
        ? number
        : GetScalarType<T[P], AggregateField_definitions[P]>
      : GetScalarType<T[P], AggregateField_definitions[P]>
  }




  export type field_definitionsGroupByArgs<ExtArgs extends $Extensions.InternalArgs = $Extensions.DefaultArgs> = {
    where?: field_definitionsWhereInput
    orderBy?: field_definitionsOrderByWithAggregationInput | field_definitionsOrderByWithAggregationInput[]
    by: Field_definitionsScalarFieldEnum[] | Field_definitionsScalarFieldEnum
    having?: field_definitionsScalarWhereWithAggregatesInput
    take?: number
    skip?: number
    _count?: Field_definitionsCountAggregateInputType | true
    _min?: Field_definitionsMinAggregateInputType
    _max?: Field_definitionsMaxAggregateInputType
  }

  export type Field_definitionsGroupByOutputType = {
    id: string
    fieldId: string
    stage: string
    promptRole: string
    valueType: string
    snakeName: string | null
    camelName: string | null
    description: string | null
    enumValues: string | null
    schemaVersion: string
    source: string
    managedByCode: boolean
    systemLocked: boolean
    structureLocked: boolean
    bindings: string | null
    metadata: string | null
    createdAt: Date
    updatedAt: Date
    _count: Field_definitionsCountAggregateOutputType | null
    _min: Field_definitionsMinAggregateOutputType | null
    _max: Field_definitionsMaxAggregateOutputType | null
  }

  type GetField_definitionsGroupByPayload<T extends field_definitionsGroupByArgs> = Prisma.PrismaPromise<
    Array<
      PickEnumerable<Field_definitionsGroupByOutputType, T['by']> &
        {
          [P in ((keyof T) & (keyof Field_definitionsGroupByOutputType))]: P extends '_count'
            ? T[P] extends boolean
              ? number
              : GetScalarType<T[P], Field_definitionsGroupByOutputType[P]>
            : GetScalarType<T[P], Field_definitionsGroupByOutputType[P]>
        }
      >
    >


  export type field_definitionsSelect<ExtArgs extends $Extensions.InternalArgs = $Extensions.DefaultArgs> = $Extensions.GetSelect<{
    id?: boolean
    fieldId?: boolean
    stage?: boolean
    promptRole?: boolean
    valueType?: boolean
    snakeName?: boolean
    camelName?: boolean
    description?: boolean
    enumValues?: boolean
    schemaVersion?: boolean
    source?: boolean
    managedByCode?: boolean
    systemLocked?: boolean
    structureLocked?: boolean
    bindings?: boolean
    metadata?: boolean
    createdAt?: boolean
    updatedAt?: boolean
  }, ExtArgs["result"]["field_definitions"]>

  export type field_definitionsSelectCreateManyAndReturn<ExtArgs extends $Extensions.InternalArgs = $Extensions.DefaultArgs> = $Extensions.GetSelect<{
    id?: boolean
    fieldId?: boolean
    stage?: boolean
    promptRole?: boolean
    valueType?: boolean
    snakeName?: boolean
    camelName?: boolean
    description?: boolean
    enumValues?: boolean
    schemaVersion?: boolean
    source?: boolean
    managedByCode?: boolean
    systemLocked?: boolean
    structureLocked?: boolean
    bindings?: boolean
    metadata?: boolean
    createdAt?: boolean
    updatedAt?: boolean
  }, ExtArgs["result"]["field_definitions"]>

  export type field_definitionsSelectScalar = {
    id?: boolean
    fieldId?: boolean
    stage?: boolean
    promptRole?: boolean
    valueType?: boolean
    snakeName?: boolean
    camelName?: boolean
    description?: boolean
    enumValues?: boolean
    schemaVersion?: boolean
    source?: boolean
    managedByCode?: boolean
    systemLocked?: boolean
    structureLocked?: boolean
    bindings?: boolean
    metadata?: boolean
    createdAt?: boolean
    updatedAt?: boolean
  }


  export type $field_definitionsPayload<ExtArgs extends $Extensions.InternalArgs = $Extensions.DefaultArgs> = {
    name: "field_definitions"
    objects: {}
    scalars: $Extensions.GetPayloadResult<{
      id: string
      fieldId: string
      stage: string
      promptRole: string
      valueType: string
      snakeName: string | null
      camelName: string | null
      description: string | null
      enumValues: string | null
      schemaVersion: string
      source: string
      managedByCode: boolean
      systemLocked: boolean
      structureLocked: boolean
      bindings: string | null
      metadata: string | null
      createdAt: Date
      updatedAt: Date
    }, ExtArgs["result"]["field_definitions"]>
    composites: {}
  }

  type field_definitionsGetPayload<S extends boolean | null | undefined | field_definitionsDefaultArgs> = $Result.GetResult<Prisma.$field_definitionsPayload, S>

  type field_definitionsCountArgs<ExtArgs extends $Extensions.InternalArgs = $Extensions.DefaultArgs> = 
    Omit<field_definitionsFindManyArgs, 'select' | 'include' | 'distinct'> & {
      select?: Field_definitionsCountAggregateInputType | true
    }

  export interface field_definitionsDelegate<ExtArgs extends $Extensions.InternalArgs = $Extensions.DefaultArgs> {
    [K: symbol]: { types: Prisma.TypeMap<ExtArgs>['model']['field_definitions'], meta: { name: 'field_definitions' } }
    /**
     * Find zero or one Field_definitions that matches the filter.
     * @param {field_definitionsFindUniqueArgs} args - Arguments to find a Field_definitions
     * @example
     * // Get one Field_definitions
     * const field_definitions = await prisma.field_definitions.findUnique({
     *   where: {
     *     // ... provide filter here
     *   }
     * })
     */
    findUnique<T extends field_definitionsFindUniqueArgs>(args: SelectSubset<T, field_definitionsFindUniqueArgs<ExtArgs>>): Prisma__field_definitionsClient<$Result.GetResult<Prisma.$field_definitionsPayload<ExtArgs>, T, "findUnique"> | null, null, ExtArgs>

    /**
     * Find one Field_definitions that matches the filter or throw an error with `error.code='P2025'` 
     * if no matches were found.
     * @param {field_definitionsFindUniqueOrThrowArgs} args - Arguments to find a Field_definitions
     * @example
     * // Get one Field_definitions
     * const field_definitions = await prisma.field_definitions.findUniqueOrThrow({
     *   where: {
     *     // ... provide filter here
     *   }
     * })
     */
    findUniqueOrThrow<T extends field_definitionsFindUniqueOrThrowArgs>(args: SelectSubset<T, field_definitionsFindUniqueOrThrowArgs<ExtArgs>>): Prisma__field_definitionsClient<$Result.GetResult<Prisma.$field_definitionsPayload<ExtArgs>, T, "findUniqueOrThrow">, never, ExtArgs>

    /**
     * Find the first Field_definitions that matches the filter.
     * Note, that providing `undefined` is treated as the value not being there.
     * Read more here: https://pris.ly/d/null-undefined
     * @param {field_definitionsFindFirstArgs} args - Arguments to find a Field_definitions
     * @example
     * // Get one Field_definitions
     * const field_definitions = await prisma.field_definitions.findFirst({
     *   where: {
     *     // ... provide filter here
     *   }
     * })
     */
    findFirst<T extends field_definitionsFindFirstArgs>(args?: SelectSubset<T, field_definitionsFindFirstArgs<ExtArgs>>): Prisma__field_definitionsClient<$Result.GetResult<Prisma.$field_definitionsPayload<ExtArgs>, T, "findFirst"> | null, null, ExtArgs>

    /**
     * Find the first Field_definitions that matches the filter or
     * throw `PrismaKnownClientError` with `P2025` code if no matches were found.
     * Note, that providing `undefined` is treated as the value not being there.
     * Read more here: https://pris.ly/d/null-undefined
     * @param {field_definitionsFindFirstOrThrowArgs} args - Arguments to find a Field_definitions
     * @example
     * // Get one Field_definitions
     * const field_definitions = await prisma.field_definitions.findFirstOrThrow({
     *   where: {
     *     // ... provide filter here
     *   }
     * })
     */
    findFirstOrThrow<T extends field_definitionsFindFirstOrThrowArgs>(args?: SelectSubset<T, field_definitionsFindFirstOrThrowArgs<ExtArgs>>): Prisma__field_definitionsClient<$Result.GetResult<Prisma.$field_definitionsPayload<ExtArgs>, T, "findFirstOrThrow">, never, ExtArgs>

    /**
     * Find zero or more Field_definitions that matches the filter.
     * Note, that providing `undefined` is treated as the value not being there.
     * Read more here: https://pris.ly/d/null-undefined
     * @param {field_definitionsFindManyArgs} args - Arguments to filter and select certain fields only.
     * @example
     * // Get all Field_definitions
     * const field_definitions = await prisma.field_definitions.findMany()
     * 
     * // Get first 10 Field_definitions
     * const field_definitions = await prisma.field_definitions.findMany({ take: 10 })
     * 
     * // Only select the `id`
     * const field_definitionsWithIdOnly = await prisma.field_definitions.findMany({ select: { id: true } })
     * 
     */
    findMany<T extends field_definitionsFindManyArgs>(args?: SelectSubset<T, field_definitionsFindManyArgs<ExtArgs>>): Prisma.PrismaPromise<$Result.GetResult<Prisma.$field_definitionsPayload<ExtArgs>, T, "findMany">>

    /**
     * Create a Field_definitions.
     * @param {field_definitionsCreateArgs} args - Arguments to create a Field_definitions.
     * @example
     * // Create one Field_definitions
     * const Field_definitions = await prisma.field_definitions.create({
     *   data: {
     *     // ... data to create a Field_definitions
     *   }
     * })
     * 
     */
    create<T extends field_definitionsCreateArgs>(args: SelectSubset<T, field_definitionsCreateArgs<ExtArgs>>): Prisma__field_definitionsClient<$Result.GetResult<Prisma.$field_definitionsPayload<ExtArgs>, T, "create">, never, ExtArgs>

    /**
     * Create many Field_definitions.
     * @param {field_definitionsCreateManyArgs} args - Arguments to create many Field_definitions.
     * @example
     * // Create many Field_definitions
     * const field_definitions = await prisma.field_definitions.createMany({
     *   data: [
     *     // ... provide data here
     *   ]
     * })
     *     
     */
    createMany<T extends field_definitionsCreateManyArgs>(args?: SelectSubset<T, field_definitionsCreateManyArgs<ExtArgs>>): Prisma.PrismaPromise<BatchPayload>

    /**
     * Create many Field_definitions and returns the data saved in the database.
     * @param {field_definitionsCreateManyAndReturnArgs} args - Arguments to create many Field_definitions.
     * @example
     * // Create many Field_definitions
     * const field_definitions = await prisma.field_definitions.createManyAndReturn({
     *   data: [
     *     // ... provide data here
     *   ]
     * })
     * 
     * // Create many Field_definitions and only return the `id`
     * const field_definitionsWithIdOnly = await prisma.field_definitions.createManyAndReturn({ 
     *   select: { id: true },
     *   data: [
     *     // ... provide data here
     *   ]
     * })
     * Note, that providing `undefined` is treated as the value not being there.
     * Read more here: https://pris.ly/d/null-undefined
     * 
     */
    createManyAndReturn<T extends field_definitionsCreateManyAndReturnArgs>(args?: SelectSubset<T, field_definitionsCreateManyAndReturnArgs<ExtArgs>>): Prisma.PrismaPromise<$Result.GetResult<Prisma.$field_definitionsPayload<ExtArgs>, T, "createManyAndReturn">>

    /**
     * Delete a Field_definitions.
     * @param {field_definitionsDeleteArgs} args - Arguments to delete one Field_definitions.
     * @example
     * // Delete one Field_definitions
     * const Field_definitions = await prisma.field_definitions.delete({
     *   where: {
     *     // ... filter to delete one Field_definitions
     *   }
     * })
     * 
     */
    delete<T extends field_definitionsDeleteArgs>(args: SelectSubset<T, field_definitionsDeleteArgs<ExtArgs>>): Prisma__field_definitionsClient<$Result.GetResult<Prisma.$field_definitionsPayload<ExtArgs>, T, "delete">, never, ExtArgs>

    /**
     * Update one Field_definitions.
     * @param {field_definitionsUpdateArgs} args - Arguments to update one Field_definitions.
     * @example
     * // Update one Field_definitions
     * const field_definitions = await prisma.field_definitions.update({
     *   where: {
     *     // ... provide filter here
     *   },
     *   data: {
     *     // ... provide data here
     *   }
     * })
     * 
     */
    update<T extends field_definitionsUpdateArgs>(args: SelectSubset<T, field_definitionsUpdateArgs<ExtArgs>>): Prisma__field_definitionsClient<$Result.GetResult<Prisma.$field_definitionsPayload<ExtArgs>, T, "update">, never, ExtArgs>

    /**
     * Delete zero or more Field_definitions.
     * @param {field_definitionsDeleteManyArgs} args - Arguments to filter Field_definitions to delete.
     * @example
     * // Delete a few Field_definitions
     * const { count } = await prisma.field_definitions.deleteMany({
     *   where: {
     *     // ... provide filter here
     *   }
     * })
     * 
     */
    deleteMany<T extends field_definitionsDeleteManyArgs>(args?: SelectSubset<T, field_definitionsDeleteManyArgs<ExtArgs>>): Prisma.PrismaPromise<BatchPayload>

    /**
     * Update zero or more Field_definitions.
     * Note, that providing `undefined` is treated as the value not being there.
     * Read more here: https://pris.ly/d/null-undefined
     * @param {field_definitionsUpdateManyArgs} args - Arguments to update one or more rows.
     * @example
     * // Update many Field_definitions
     * const field_definitions = await prisma.field_definitions.updateMany({
     *   where: {
     *     // ... provide filter here
     *   },
     *   data: {
     *     // ... provide data here
     *   }
     * })
     * 
     */
    updateMany<T extends field_definitionsUpdateManyArgs>(args: SelectSubset<T, field_definitionsUpdateManyArgs<ExtArgs>>): Prisma.PrismaPromise<BatchPayload>

    /**
     * Create or update one Field_definitions.
     * @param {field_definitionsUpsertArgs} args - Arguments to update or create a Field_definitions.
     * @example
     * // Update or create a Field_definitions
     * const field_definitions = await prisma.field_definitions.upsert({
     *   create: {
     *     // ... data to create a Field_definitions
     *   },
     *   update: {
     *     // ... in case it already exists, update
     *   },
     *   where: {
     *     // ... the filter for the Field_definitions we want to update
     *   }
     * })
     */
    upsert<T extends field_definitionsUpsertArgs>(args: SelectSubset<T, field_definitionsUpsertArgs<ExtArgs>>): Prisma__field_definitionsClient<$Result.GetResult<Prisma.$field_definitionsPayload<ExtArgs>, T, "upsert">, never, ExtArgs>


    /**
     * Count the number of Field_definitions.
     * Note, that providing `undefined` is treated as the value not being there.
     * Read more here: https://pris.ly/d/null-undefined
     * @param {field_definitionsCountArgs} args - Arguments to filter Field_definitions to count.
     * @example
     * // Count the number of Field_definitions
     * const count = await prisma.field_definitions.count({
     *   where: {
     *     // ... the filter for the Field_definitions we want to count
     *   }
     * })
    **/
    count<T extends field_definitionsCountArgs>(
      args?: Subset<T, field_definitionsCountArgs>,
    ): Prisma.PrismaPromise<
      T extends $Utils.Record<'select', any>
        ? T['select'] extends true
          ? number
          : GetScalarType<T['select'], Field_definitionsCountAggregateOutputType>
        : number
    >

    /**
     * Allows you to perform aggregations operations on a Field_definitions.
     * Note, that providing `undefined` is treated as the value not being there.
     * Read more here: https://pris.ly/d/null-undefined
     * @param {Field_definitionsAggregateArgs} args - Select which aggregations you would like to apply and on what fields.
     * @example
     * // Ordered by age ascending
     * // Where email contains prisma.io
     * // Limited to the 10 users
     * const aggregations = await prisma.user.aggregate({
     *   _avg: {
     *     age: true,
     *   },
     *   where: {
     *     email: {
     *       contains: "prisma.io",
     *     },
     *   },
     *   orderBy: {
     *     age: "asc",
     *   },
     *   take: 10,
     * })
    **/
    aggregate<T extends Field_definitionsAggregateArgs>(args: Subset<T, Field_definitionsAggregateArgs>): Prisma.PrismaPromise<GetField_definitionsAggregateType<T>>

    /**
     * Group by Field_definitions.
     * Note, that providing `undefined` is treated as the value not being there.
     * Read more here: https://pris.ly/d/null-undefined
     * @param {field_definitionsGroupByArgs} args - Group by arguments.
     * @example
     * // Group by city, order by createdAt, get count
     * const result = await prisma.user.groupBy({
     *   by: ['city', 'createdAt'],
     *   orderBy: {
     *     createdAt: true
     *   },
     *   _count: {
     *     _all: true
     *   },
     * })
     * 
    **/
    groupBy<
      T extends field_definitionsGroupByArgs,
      HasSelectOrTake extends Or<
        Extends<'skip', Keys<T>>,
        Extends<'take', Keys<T>>
      >,
      OrderByArg extends True extends HasSelectOrTake
        ? { orderBy: field_definitionsGroupByArgs['orderBy'] }
        : { orderBy?: field_definitionsGroupByArgs['orderBy'] },
      OrderFields extends ExcludeUnderscoreKeys<Keys<MaybeTupleToUnion<T['orderBy']>>>,
      ByFields extends MaybeTupleToUnion<T['by']>,
      ByValid extends Has<ByFields, OrderFields>,
      HavingFields extends GetHavingFields<T['having']>,
      HavingValid extends Has<ByFields, HavingFields>,
      ByEmpty extends T['by'] extends never[] ? True : False,
      InputErrors extends ByEmpty extends True
      ? `Error: "by" must not be empty.`
      : HavingValid extends False
      ? {
          [P in HavingFields]: P extends ByFields
            ? never
            : P extends string
            ? `Error: Field "${P}" used in "having" needs to be provided in "by".`
            : [
                Error,
                'Field ',
                P,
                ` in "having" needs to be provided in "by"`,
              ]
        }[HavingFields]
      : 'take' extends Keys<T>
      ? 'orderBy' extends Keys<T>
        ? ByValid extends True
          ? {}
          : {
              [P in OrderFields]: P extends ByFields
                ? never
                : `Error: Field "${P}" in "orderBy" needs to be provided in "by"`
            }[OrderFields]
        : 'Error: If you provide "take", you also need to provide "orderBy"'
      : 'skip' extends Keys<T>
      ? 'orderBy' extends Keys<T>
        ? ByValid extends True
          ? {}
          : {
              [P in OrderFields]: P extends ByFields
                ? never
                : `Error: Field "${P}" in "orderBy" needs to be provided in "by"`
            }[OrderFields]
        : 'Error: If you provide "skip", you also need to provide "orderBy"'
      : ByValid extends True
      ? {}
      : {
          [P in OrderFields]: P extends ByFields
            ? never
            : `Error: Field "${P}" in "orderBy" needs to be provided in "by"`
        }[OrderFields]
    >(args: SubsetIntersection<T, field_definitionsGroupByArgs, OrderByArg> & InputErrors): {} extends InputErrors ? GetField_definitionsGroupByPayload<T> : Prisma.PrismaPromise<InputErrors>
  /**
   * Fields of the field_definitions model
   */
  readonly fields: field_definitionsFieldRefs;
  }

  /**
   * The delegate class that acts as a "Promise-like" for field_definitions.
   * Why is this prefixed with `Prisma__`?
   * Because we want to prevent naming conflicts as mentioned in
   * https://github.com/prisma/prisma-client-js/issues/707
   */
  export interface Prisma__field_definitionsClient<T, Null = never, ExtArgs extends $Extensions.InternalArgs = $Extensions.DefaultArgs> extends Prisma.PrismaPromise<T> {
    readonly [Symbol.toStringTag]: "PrismaPromise"
    /**
     * Attaches callbacks for the resolution and/or rejection of the Promise.
     * @param onfulfilled The callback to execute when the Promise is resolved.
     * @param onrejected The callback to execute when the Promise is rejected.
     * @returns A Promise for the completion of which ever callback is executed.
     */
    then<TResult1 = T, TResult2 = never>(onfulfilled?: ((value: T) => TResult1 | PromiseLike<TResult1>) | undefined | null, onrejected?: ((reason: any) => TResult2 | PromiseLike<TResult2>) | undefined | null): $Utils.JsPromise<TResult1 | TResult2>
    /**
     * Attaches a callback for only the rejection of the Promise.
     * @param onrejected The callback to execute when the Promise is rejected.
     * @returns A Promise for the completion of the callback.
     */
    catch<TResult = never>(onrejected?: ((reason: any) => TResult | PromiseLike<TResult>) | undefined | null): $Utils.JsPromise<T | TResult>
    /**
     * Attaches a callback that is invoked when the Promise is settled (fulfilled or rejected). The
     * resolved value cannot be modified from the callback.
     * @param onfinally The callback to execute when the Promise is settled (fulfilled or rejected).
     * @returns A Promise for the completion of the callback.
     */
    finally(onfinally?: (() => void) | undefined | null): $Utils.JsPromise<T>
  }




  /**
   * Fields of the field_definitions model
   */ 
  interface field_definitionsFieldRefs {
    readonly id: FieldRef<"field_definitions", 'String'>
    readonly fieldId: FieldRef<"field_definitions", 'String'>
    readonly stage: FieldRef<"field_definitions", 'String'>
    readonly promptRole: FieldRef<"field_definitions", 'String'>
    readonly valueType: FieldRef<"field_definitions", 'String'>
    readonly snakeName: FieldRef<"field_definitions", 'String'>
    readonly camelName: FieldRef<"field_definitions", 'String'>
    readonly description: FieldRef<"field_definitions", 'String'>
    readonly enumValues: FieldRef<"field_definitions", 'String'>
    readonly schemaVersion: FieldRef<"field_definitions", 'String'>
    readonly source: FieldRef<"field_definitions", 'String'>
    readonly managedByCode: FieldRef<"field_definitions", 'Boolean'>
    readonly systemLocked: FieldRef<"field_definitions", 'Boolean'>
    readonly structureLocked: FieldRef<"field_definitions", 'Boolean'>
    readonly bindings: FieldRef<"field_definitions", 'String'>
    readonly metadata: FieldRef<"field_definitions", 'String'>
    readonly createdAt: FieldRef<"field_definitions", 'DateTime'>
    readonly updatedAt: FieldRef<"field_definitions", 'DateTime'>
  }
    

  // Custom InputTypes
  /**
   * field_definitions findUnique
   */
  export type field_definitionsFindUniqueArgs<ExtArgs extends $Extensions.InternalArgs = $Extensions.DefaultArgs> = {
    /**
     * Select specific fields to fetch from the field_definitions
     */
    select?: field_definitionsSelect<ExtArgs> | null
    /**
     * Filter, which field_definitions to fetch.
     */
    where: field_definitionsWhereUniqueInput
  }

  /**
   * field_definitions findUniqueOrThrow
   */
  export type field_definitionsFindUniqueOrThrowArgs<ExtArgs extends $Extensions.InternalArgs = $Extensions.DefaultArgs> = {
    /**
     * Select specific fields to fetch from the field_definitions
     */
    select?: field_definitionsSelect<ExtArgs> | null
    /**
     * Filter, which field_definitions to fetch.
     */
    where: field_definitionsWhereUniqueInput
  }

  /**
   * field_definitions findFirst
   */
  export type field_definitionsFindFirstArgs<ExtArgs extends $Extensions.InternalArgs = $Extensions.DefaultArgs> = {
    /**
     * Select specific fields to fetch from the field_definitions
     */
    select?: field_definitionsSelect<ExtArgs> | null
    /**
     * Filter, which field_definitions to fetch.
     */
    where?: field_definitionsWhereInput
    /**
     * {@link https://www.prisma.io/docs/concepts/components/prisma-client/sorting Sorting Docs}
     * 
     * Determine the order of field_definitions to fetch.
     */
    orderBy?: field_definitionsOrderByWithRelationInput | field_definitionsOrderByWithRelationInput[]
    /**
     * {@link https://www.prisma.io/docs/concepts/components/prisma-client/pagination#cursor-based-pagination Cursor Docs}
     * 
     * Sets the position for searching for field_definitions.
     */
    cursor?: field_definitionsWhereUniqueInput
    /**
     * {@link https://www.prisma.io/docs/concepts/components/prisma-client/pagination Pagination Docs}
     * 
     * Take `±n` field_definitions from the position of the cursor.
     */
    take?: number
    /**
     * {@link https://www.prisma.io/docs/concepts/components/prisma-client/pagination Pagination Docs}
     * 
     * Skip the first `n` field_definitions.
     */
    skip?: number
    /**
     * {@link https://www.prisma.io/docs/concepts/components/prisma-client/distinct Distinct Docs}
     * 
     * Filter by unique combinations of field_definitions.
     */
    distinct?: Field_definitionsScalarFieldEnum | Field_definitionsScalarFieldEnum[]
  }

  /**
   * field_definitions findFirstOrThrow
   */
  export type field_definitionsFindFirstOrThrowArgs<ExtArgs extends $Extensions.InternalArgs = $Extensions.DefaultArgs> = {
    /**
     * Select specific fields to fetch from the field_definitions
     */
    select?: field_definitionsSelect<ExtArgs> | null
    /**
     * Filter, which field_definitions to fetch.
     */
    where?: field_definitionsWhereInput
    /**
     * {@link https://www.prisma.io/docs/concepts/components/prisma-client/sorting Sorting Docs}
     * 
     * Determine the order of field_definitions to fetch.
     */
    orderBy?: field_definitionsOrderByWithRelationInput | field_definitionsOrderByWithRelationInput[]
    /**
     * {@link https://www.prisma.io/docs/concepts/components/prisma-client/pagination#cursor-based-pagination Cursor Docs}
     * 
     * Sets the position for searching for field_definitions.
     */
    cursor?: field_definitionsWhereUniqueInput
    /**
     * {@link https://www.prisma.io/docs/concepts/components/prisma-client/pagination Pagination Docs}
     * 
     * Take `±n` field_definitions from the position of the cursor.
     */
    take?: number
    /**
     * {@link https://www.prisma.io/docs/concepts/components/prisma-client/pagination Pagination Docs}
     * 
     * Skip the first `n` field_definitions.
     */
    skip?: number
    /**
     * {@link https://www.prisma.io/docs/concepts/components/prisma-client/distinct Distinct Docs}
     * 
     * Filter by unique combinations of field_definitions.
     */
    distinct?: Field_definitionsScalarFieldEnum | Field_definitionsScalarFieldEnum[]
  }

  /**
   * field_definitions findMany
   */
  export type field_definitionsFindManyArgs<ExtArgs extends $Extensions.InternalArgs = $Extensions.DefaultArgs> = {
    /**
     * Select specific fields to fetch from the field_definitions
     */
    select?: field_definitionsSelect<ExtArgs> | null
    /**
     * Filter, which field_definitions to fetch.
     */
    where?: field_definitionsWhereInput
    /**
     * {@link https://www.prisma.io/docs/concepts/components/prisma-client/sorting Sorting Docs}
     * 
     * Determine the order of field_definitions to fetch.
     */
    orderBy?: field_definitionsOrderByWithRelationInput | field_definitionsOrderByWithRelationInput[]
    /**
     * {@link https://www.prisma.io/docs/concepts/components/prisma-client/pagination#cursor-based-pagination Cursor Docs}
     * 
     * Sets the position for listing field_definitions.
     */
    cursor?: field_definitionsWhereUniqueInput
    /**
     * {@link https://www.prisma.io/docs/concepts/components/prisma-client/pagination Pagination Docs}
     * 
     * Take `±n` field_definitions from the position of the cursor.
     */
    take?: number
    /**
     * {@link https://www.prisma.io/docs/concepts/components/prisma-client/pagination Pagination Docs}
     * 
     * Skip the first `n` field_definitions.
     */
    skip?: number
    distinct?: Field_definitionsScalarFieldEnum | Field_definitionsScalarFieldEnum[]
  }

  /**
   * field_definitions create
   */
  export type field_definitionsCreateArgs<ExtArgs extends $Extensions.InternalArgs = $Extensions.DefaultArgs> = {
    /**
     * Select specific fields to fetch from the field_definitions
     */
    select?: field_definitionsSelect<ExtArgs> | null
    /**
     * The data needed to create a field_definitions.
     */
    data: XOR<field_definitionsCreateInput, field_definitionsUncheckedCreateInput>
  }

  /**
   * field_definitions createMany
   */
  export type field_definitionsCreateManyArgs<ExtArgs extends $Extensions.InternalArgs = $Extensions.DefaultArgs> = {
    /**
     * The data used to create many field_definitions.
     */
    data: field_definitionsCreateManyInput | field_definitionsCreateManyInput[]
  }

  /**
   * field_definitions createManyAndReturn
   */
  export type field_definitionsCreateManyAndReturnArgs<ExtArgs extends $Extensions.InternalArgs = $Extensions.DefaultArgs> = {
    /**
     * Select specific fields to fetch from the field_definitions
     */
    select?: field_definitionsSelectCreateManyAndReturn<ExtArgs> | null
    /**
     * The data used to create many field_definitions.
     */
    data: field_definitionsCreateManyInput | field_definitionsCreateManyInput[]
  }

  /**
   * field_definitions update
   */
  export type field_definitionsUpdateArgs<ExtArgs extends $Extensions.InternalArgs = $Extensions.DefaultArgs> = {
    /**
     * Select specific fields to fetch from the field_definitions
     */
    select?: field_definitionsSelect<ExtArgs> | null
    /**
     * The data needed to update a field_definitions.
     */
    data: XOR<field_definitionsUpdateInput, field_definitionsUncheckedUpdateInput>
    /**
     * Choose, which field_definitions to update.
     */
    where: field_definitionsWhereUniqueInput
  }

  /**
   * field_definitions updateMany
   */
  export type field_definitionsUpdateManyArgs<ExtArgs extends $Extensions.InternalArgs = $Extensions.DefaultArgs> = {
    /**
     * The data used to update field_definitions.
     */
    data: XOR<field_definitionsUpdateManyMutationInput, field_definitionsUncheckedUpdateManyInput>
    /**
     * Filter which field_definitions to update
     */
    where?: field_definitionsWhereInput
  }

  /**
   * field_definitions upsert
   */
  export type field_definitionsUpsertArgs<ExtArgs extends $Extensions.InternalArgs = $Extensions.DefaultArgs> = {
    /**
     * Select specific fields to fetch from the field_definitions
     */
    select?: field_definitionsSelect<ExtArgs> | null
    /**
     * The filter to search for the field_definitions to update in case it exists.
     */
    where: field_definitionsWhereUniqueInput
    /**
     * In case the field_definitions found by the `where` argument doesn't exist, create a new field_definitions with this data.
     */
    create: XOR<field_definitionsCreateInput, field_definitionsUncheckedCreateInput>
    /**
     * In case the field_definitions was found with the provided `where` argument, update it with this data.
     */
    update: XOR<field_definitionsUpdateInput, field_definitionsUncheckedUpdateInput>
  }

  /**
   * field_definitions delete
   */
  export type field_definitionsDeleteArgs<ExtArgs extends $Extensions.InternalArgs = $Extensions.DefaultArgs> = {
    /**
     * Select specific fields to fetch from the field_definitions
     */
    select?: field_definitionsSelect<ExtArgs> | null
    /**
     * Filter which field_definitions to delete.
     */
    where: field_definitionsWhereUniqueInput
  }

  /**
   * field_definitions deleteMany
   */
  export type field_definitionsDeleteManyArgs<ExtArgs extends $Extensions.InternalArgs = $Extensions.DefaultArgs> = {
    /**
     * Filter which field_definitions to delete
     */
    where?: field_definitionsWhereInput
  }

  /**
   * field_definitions without action
   */
  export type field_definitionsDefaultArgs<ExtArgs extends $Extensions.InternalArgs = $Extensions.DefaultArgs> = {
    /**
     * Select specific fields to fetch from the field_definitions
     */
    select?: field_definitionsSelect<ExtArgs> | null
  }


  /**
   * Model agent_contracts
   */

  export type AggregateAgent_contracts = {
    _count: Agent_contractsCountAggregateOutputType | null
    _min: Agent_contractsMinAggregateOutputType | null
    _max: Agent_contractsMaxAggregateOutputType | null
  }

  export type Agent_contractsMinAggregateOutputType = {
    id: string | null
    agentId: string | null
    stage: string | null
    displayName: string | null
    description: string | null
    schemaVersion: string | null
    source: string | null
    managedByCode: boolean | null
    metadata: string | null
    createdAt: Date | null
    updatedAt: Date | null
  }

  export type Agent_contractsMaxAggregateOutputType = {
    id: string | null
    agentId: string | null
    stage: string | null
    displayName: string | null
    description: string | null
    schemaVersion: string | null
    source: string | null
    managedByCode: boolean | null
    metadata: string | null
    createdAt: Date | null
    updatedAt: Date | null
  }

  export type Agent_contractsCountAggregateOutputType = {
    id: number
    agentId: number
    stage: number
    displayName: number
    description: number
    schemaVersion: number
    source: number
    managedByCode: number
    metadata: number
    createdAt: number
    updatedAt: number
    _all: number
  }


  export type Agent_contractsMinAggregateInputType = {
    id?: true
    agentId?: true
    stage?: true
    displayName?: true
    description?: true
    schemaVersion?: true
    source?: true
    managedByCode?: true
    metadata?: true
    createdAt?: true
    updatedAt?: true
  }

  export type Agent_contractsMaxAggregateInputType = {
    id?: true
    agentId?: true
    stage?: true
    displayName?: true
    description?: true
    schemaVersion?: true
    source?: true
    managedByCode?: true
    metadata?: true
    createdAt?: true
    updatedAt?: true
  }

  export type Agent_contractsCountAggregateInputType = {
    id?: true
    agentId?: true
    stage?: true
    displayName?: true
    description?: true
    schemaVersion?: true
    source?: true
    managedByCode?: true
    metadata?: true
    createdAt?: true
    updatedAt?: true
    _all?: true
  }

  export type Agent_contractsAggregateArgs<ExtArgs extends $Extensions.InternalArgs = $Extensions.DefaultArgs> = {
    /**
     * Filter which agent_contracts to aggregate.
     */
    where?: agent_contractsWhereInput
    /**
     * {@link https://www.prisma.io/docs/concepts/components/prisma-client/sorting Sorting Docs}
     * 
     * Determine the order of agent_contracts to fetch.
     */
    orderBy?: agent_contractsOrderByWithRelationInput | agent_contractsOrderByWithRelationInput[]
    /**
     * {@link https://www.prisma.io/docs/concepts/components/prisma-client/pagination#cursor-based-pagination Cursor Docs}
     * 
     * Sets the start position
     */
    cursor?: agent_contractsWhereUniqueInput
    /**
     * {@link https://www.prisma.io/docs/concepts/components/prisma-client/pagination Pagination Docs}
     * 
     * Take `±n` agent_contracts from the position of the cursor.
     */
    take?: number
    /**
     * {@link https://www.prisma.io/docs/concepts/components/prisma-client/pagination Pagination Docs}
     * 
     * Skip the first `n` agent_contracts.
     */
    skip?: number
    /**
     * {@link https://www.prisma.io/docs/concepts/components/prisma-client/aggregations Aggregation Docs}
     * 
     * Count returned agent_contracts
    **/
    _count?: true | Agent_contractsCountAggregateInputType
    /**
     * {@link https://www.prisma.io/docs/concepts/components/prisma-client/aggregations Aggregation Docs}
     * 
     * Select which fields to find the minimum value
    **/
    _min?: Agent_contractsMinAggregateInputType
    /**
     * {@link https://www.prisma.io/docs/concepts/components/prisma-client/aggregations Aggregation Docs}
     * 
     * Select which fields to find the maximum value
    **/
    _max?: Agent_contractsMaxAggregateInputType
  }

  export type GetAgent_contractsAggregateType<T extends Agent_contractsAggregateArgs> = {
        [P in keyof T & keyof AggregateAgent_contracts]: P extends '_count' | 'count'
      ? T[P] extends true
        ? number
        : GetScalarType<T[P], AggregateAgent_contracts[P]>
      : GetScalarType<T[P], AggregateAgent_contracts[P]>
  }




  export type agent_contractsGroupByArgs<ExtArgs extends $Extensions.InternalArgs = $Extensions.DefaultArgs> = {
    where?: agent_contractsWhereInput
    orderBy?: agent_contractsOrderByWithAggregationInput | agent_contractsOrderByWithAggregationInput[]
    by: Agent_contractsScalarFieldEnum[] | Agent_contractsScalarFieldEnum
    having?: agent_contractsScalarWhereWithAggregatesInput
    take?: number
    skip?: number
    _count?: Agent_contractsCountAggregateInputType | true
    _min?: Agent_contractsMinAggregateInputType
    _max?: Agent_contractsMaxAggregateInputType
  }

  export type Agent_contractsGroupByOutputType = {
    id: string
    agentId: string
    stage: string
    displayName: string
    description: string | null
    schemaVersion: string
    source: string
    managedByCode: boolean
    metadata: string | null
    createdAt: Date
    updatedAt: Date
    _count: Agent_contractsCountAggregateOutputType | null
    _min: Agent_contractsMinAggregateOutputType | null
    _max: Agent_contractsMaxAggregateOutputType | null
  }

  type GetAgent_contractsGroupByPayload<T extends agent_contractsGroupByArgs> = Prisma.PrismaPromise<
    Array<
      PickEnumerable<Agent_contractsGroupByOutputType, T['by']> &
        {
          [P in ((keyof T) & (keyof Agent_contractsGroupByOutputType))]: P extends '_count'
            ? T[P] extends boolean
              ? number
              : GetScalarType<T[P], Agent_contractsGroupByOutputType[P]>
            : GetScalarType<T[P], Agent_contractsGroupByOutputType[P]>
        }
      >
    >


  export type agent_contractsSelect<ExtArgs extends $Extensions.InternalArgs = $Extensions.DefaultArgs> = $Extensions.GetSelect<{
    id?: boolean
    agentId?: boolean
    stage?: boolean
    displayName?: boolean
    description?: boolean
    schemaVersion?: boolean
    source?: boolean
    managedByCode?: boolean
    metadata?: boolean
    createdAt?: boolean
    updatedAt?: boolean
  }, ExtArgs["result"]["agent_contracts"]>

  export type agent_contractsSelectCreateManyAndReturn<ExtArgs extends $Extensions.InternalArgs = $Extensions.DefaultArgs> = $Extensions.GetSelect<{
    id?: boolean
    agentId?: boolean
    stage?: boolean
    displayName?: boolean
    description?: boolean
    schemaVersion?: boolean
    source?: boolean
    managedByCode?: boolean
    metadata?: boolean
    createdAt?: boolean
    updatedAt?: boolean
  }, ExtArgs["result"]["agent_contracts"]>

  export type agent_contractsSelectScalar = {
    id?: boolean
    agentId?: boolean
    stage?: boolean
    displayName?: boolean
    description?: boolean
    schemaVersion?: boolean
    source?: boolean
    managedByCode?: boolean
    metadata?: boolean
    createdAt?: boolean
    updatedAt?: boolean
  }


  export type $agent_contractsPayload<ExtArgs extends $Extensions.InternalArgs = $Extensions.DefaultArgs> = {
    name: "agent_contracts"
    objects: {}
    scalars: $Extensions.GetPayloadResult<{
      id: string
      agentId: string
      stage: string
      displayName: string
      description: string | null
      schemaVersion: string
      source: string
      managedByCode: boolean
      metadata: string | null
      createdAt: Date
      updatedAt: Date
    }, ExtArgs["result"]["agent_contracts"]>
    composites: {}
  }

  type agent_contractsGetPayload<S extends boolean | null | undefined | agent_contractsDefaultArgs> = $Result.GetResult<Prisma.$agent_contractsPayload, S>

  type agent_contractsCountArgs<ExtArgs extends $Extensions.InternalArgs = $Extensions.DefaultArgs> = 
    Omit<agent_contractsFindManyArgs, 'select' | 'include' | 'distinct'> & {
      select?: Agent_contractsCountAggregateInputType | true
    }

  export interface agent_contractsDelegate<ExtArgs extends $Extensions.InternalArgs = $Extensions.DefaultArgs> {
    [K: symbol]: { types: Prisma.TypeMap<ExtArgs>['model']['agent_contracts'], meta: { name: 'agent_contracts' } }
    /**
     * Find zero or one Agent_contracts that matches the filter.
     * @param {agent_contractsFindUniqueArgs} args - Arguments to find a Agent_contracts
     * @example
     * // Get one Agent_contracts
     * const agent_contracts = await prisma.agent_contracts.findUnique({
     *   where: {
     *     // ... provide filter here
     *   }
     * })
     */
    findUnique<T extends agent_contractsFindUniqueArgs>(args: SelectSubset<T, agent_contractsFindUniqueArgs<ExtArgs>>): Prisma__agent_contractsClient<$Result.GetResult<Prisma.$agent_contractsPayload<ExtArgs>, T, "findUnique"> | null, null, ExtArgs>

    /**
     * Find one Agent_contracts that matches the filter or throw an error with `error.code='P2025'` 
     * if no matches were found.
     * @param {agent_contractsFindUniqueOrThrowArgs} args - Arguments to find a Agent_contracts
     * @example
     * // Get one Agent_contracts
     * const agent_contracts = await prisma.agent_contracts.findUniqueOrThrow({
     *   where: {
     *     // ... provide filter here
     *   }
     * })
     */
    findUniqueOrThrow<T extends agent_contractsFindUniqueOrThrowArgs>(args: SelectSubset<T, agent_contractsFindUniqueOrThrowArgs<ExtArgs>>): Prisma__agent_contractsClient<$Result.GetResult<Prisma.$agent_contractsPayload<ExtArgs>, T, "findUniqueOrThrow">, never, ExtArgs>

    /**
     * Find the first Agent_contracts that matches the filter.
     * Note, that providing `undefined` is treated as the value not being there.
     * Read more here: https://pris.ly/d/null-undefined
     * @param {agent_contractsFindFirstArgs} args - Arguments to find a Agent_contracts
     * @example
     * // Get one Agent_contracts
     * const agent_contracts = await prisma.agent_contracts.findFirst({
     *   where: {
     *     // ... provide filter here
     *   }
     * })
     */
    findFirst<T extends agent_contractsFindFirstArgs>(args?: SelectSubset<T, agent_contractsFindFirstArgs<ExtArgs>>): Prisma__agent_contractsClient<$Result.GetResult<Prisma.$agent_contractsPayload<ExtArgs>, T, "findFirst"> | null, null, ExtArgs>

    /**
     * Find the first Agent_contracts that matches the filter or
     * throw `PrismaKnownClientError` with `P2025` code if no matches were found.
     * Note, that providing `undefined` is treated as the value not being there.
     * Read more here: https://pris.ly/d/null-undefined
     * @param {agent_contractsFindFirstOrThrowArgs} args - Arguments to find a Agent_contracts
     * @example
     * // Get one Agent_contracts
     * const agent_contracts = await prisma.agent_contracts.findFirstOrThrow({
     *   where: {
     *     // ... provide filter here
     *   }
     * })
     */
    findFirstOrThrow<T extends agent_contractsFindFirstOrThrowArgs>(args?: SelectSubset<T, agent_contractsFindFirstOrThrowArgs<ExtArgs>>): Prisma__agent_contractsClient<$Result.GetResult<Prisma.$agent_contractsPayload<ExtArgs>, T, "findFirstOrThrow">, never, ExtArgs>

    /**
     * Find zero or more Agent_contracts that matches the filter.
     * Note, that providing `undefined` is treated as the value not being there.
     * Read more here: https://pris.ly/d/null-undefined
     * @param {agent_contractsFindManyArgs} args - Arguments to filter and select certain fields only.
     * @example
     * // Get all Agent_contracts
     * const agent_contracts = await prisma.agent_contracts.findMany()
     * 
     * // Get first 10 Agent_contracts
     * const agent_contracts = await prisma.agent_contracts.findMany({ take: 10 })
     * 
     * // Only select the `id`
     * const agent_contractsWithIdOnly = await prisma.agent_contracts.findMany({ select: { id: true } })
     * 
     */
    findMany<T extends agent_contractsFindManyArgs>(args?: SelectSubset<T, agent_contractsFindManyArgs<ExtArgs>>): Prisma.PrismaPromise<$Result.GetResult<Prisma.$agent_contractsPayload<ExtArgs>, T, "findMany">>

    /**
     * Create a Agent_contracts.
     * @param {agent_contractsCreateArgs} args - Arguments to create a Agent_contracts.
     * @example
     * // Create one Agent_contracts
     * const Agent_contracts = await prisma.agent_contracts.create({
     *   data: {
     *     // ... data to create a Agent_contracts
     *   }
     * })
     * 
     */
    create<T extends agent_contractsCreateArgs>(args: SelectSubset<T, agent_contractsCreateArgs<ExtArgs>>): Prisma__agent_contractsClient<$Result.GetResult<Prisma.$agent_contractsPayload<ExtArgs>, T, "create">, never, ExtArgs>

    /**
     * Create many Agent_contracts.
     * @param {agent_contractsCreateManyArgs} args - Arguments to create many Agent_contracts.
     * @example
     * // Create many Agent_contracts
     * const agent_contracts = await prisma.agent_contracts.createMany({
     *   data: [
     *     // ... provide data here
     *   ]
     * })
     *     
     */
    createMany<T extends agent_contractsCreateManyArgs>(args?: SelectSubset<T, agent_contractsCreateManyArgs<ExtArgs>>): Prisma.PrismaPromise<BatchPayload>

    /**
     * Create many Agent_contracts and returns the data saved in the database.
     * @param {agent_contractsCreateManyAndReturnArgs} args - Arguments to create many Agent_contracts.
     * @example
     * // Create many Agent_contracts
     * const agent_contracts = await prisma.agent_contracts.createManyAndReturn({
     *   data: [
     *     // ... provide data here
     *   ]
     * })
     * 
     * // Create many Agent_contracts and only return the `id`
     * const agent_contractsWithIdOnly = await prisma.agent_contracts.createManyAndReturn({ 
     *   select: { id: true },
     *   data: [
     *     // ... provide data here
     *   ]
     * })
     * Note, that providing `undefined` is treated as the value not being there.
     * Read more here: https://pris.ly/d/null-undefined
     * 
     */
    createManyAndReturn<T extends agent_contractsCreateManyAndReturnArgs>(args?: SelectSubset<T, agent_contractsCreateManyAndReturnArgs<ExtArgs>>): Prisma.PrismaPromise<$Result.GetResult<Prisma.$agent_contractsPayload<ExtArgs>, T, "createManyAndReturn">>

    /**
     * Delete a Agent_contracts.
     * @param {agent_contractsDeleteArgs} args - Arguments to delete one Agent_contracts.
     * @example
     * // Delete one Agent_contracts
     * const Agent_contracts = await prisma.agent_contracts.delete({
     *   where: {
     *     // ... filter to delete one Agent_contracts
     *   }
     * })
     * 
     */
    delete<T extends agent_contractsDeleteArgs>(args: SelectSubset<T, agent_contractsDeleteArgs<ExtArgs>>): Prisma__agent_contractsClient<$Result.GetResult<Prisma.$agent_contractsPayload<ExtArgs>, T, "delete">, never, ExtArgs>

    /**
     * Update one Agent_contracts.
     * @param {agent_contractsUpdateArgs} args - Arguments to update one Agent_contracts.
     * @example
     * // Update one Agent_contracts
     * const agent_contracts = await prisma.agent_contracts.update({
     *   where: {
     *     // ... provide filter here
     *   },
     *   data: {
     *     // ... provide data here
     *   }
     * })
     * 
     */
    update<T extends agent_contractsUpdateArgs>(args: SelectSubset<T, agent_contractsUpdateArgs<ExtArgs>>): Prisma__agent_contractsClient<$Result.GetResult<Prisma.$agent_contractsPayload<ExtArgs>, T, "update">, never, ExtArgs>

    /**
     * Delete zero or more Agent_contracts.
     * @param {agent_contractsDeleteManyArgs} args - Arguments to filter Agent_contracts to delete.
     * @example
     * // Delete a few Agent_contracts
     * const { count } = await prisma.agent_contracts.deleteMany({
     *   where: {
     *     // ... provide filter here
     *   }
     * })
     * 
     */
    deleteMany<T extends agent_contractsDeleteManyArgs>(args?: SelectSubset<T, agent_contractsDeleteManyArgs<ExtArgs>>): Prisma.PrismaPromise<BatchPayload>

    /**
     * Update zero or more Agent_contracts.
     * Note, that providing `undefined` is treated as the value not being there.
     * Read more here: https://pris.ly/d/null-undefined
     * @param {agent_contractsUpdateManyArgs} args - Arguments to update one or more rows.
     * @example
     * // Update many Agent_contracts
     * const agent_contracts = await prisma.agent_contracts.updateMany({
     *   where: {
     *     // ... provide filter here
     *   },
     *   data: {
     *     // ... provide data here
     *   }
     * })
     * 
     */
    updateMany<T extends agent_contractsUpdateManyArgs>(args: SelectSubset<T, agent_contractsUpdateManyArgs<ExtArgs>>): Prisma.PrismaPromise<BatchPayload>

    /**
     * Create or update one Agent_contracts.
     * @param {agent_contractsUpsertArgs} args - Arguments to update or create a Agent_contracts.
     * @example
     * // Update or create a Agent_contracts
     * const agent_contracts = await prisma.agent_contracts.upsert({
     *   create: {
     *     // ... data to create a Agent_contracts
     *   },
     *   update: {
     *     // ... in case it already exists, update
     *   },
     *   where: {
     *     // ... the filter for the Agent_contracts we want to update
     *   }
     * })
     */
    upsert<T extends agent_contractsUpsertArgs>(args: SelectSubset<T, agent_contractsUpsertArgs<ExtArgs>>): Prisma__agent_contractsClient<$Result.GetResult<Prisma.$agent_contractsPayload<ExtArgs>, T, "upsert">, never, ExtArgs>


    /**
     * Count the number of Agent_contracts.
     * Note, that providing `undefined` is treated as the value not being there.
     * Read more here: https://pris.ly/d/null-undefined
     * @param {agent_contractsCountArgs} args - Arguments to filter Agent_contracts to count.
     * @example
     * // Count the number of Agent_contracts
     * const count = await prisma.agent_contracts.count({
     *   where: {
     *     // ... the filter for the Agent_contracts we want to count
     *   }
     * })
    **/
    count<T extends agent_contractsCountArgs>(
      args?: Subset<T, agent_contractsCountArgs>,
    ): Prisma.PrismaPromise<
      T extends $Utils.Record<'select', any>
        ? T['select'] extends true
          ? number
          : GetScalarType<T['select'], Agent_contractsCountAggregateOutputType>
        : number
    >

    /**
     * Allows you to perform aggregations operations on a Agent_contracts.
     * Note, that providing `undefined` is treated as the value not being there.
     * Read more here: https://pris.ly/d/null-undefined
     * @param {Agent_contractsAggregateArgs} args - Select which aggregations you would like to apply and on what fields.
     * @example
     * // Ordered by age ascending
     * // Where email contains prisma.io
     * // Limited to the 10 users
     * const aggregations = await prisma.user.aggregate({
     *   _avg: {
     *     age: true,
     *   },
     *   where: {
     *     email: {
     *       contains: "prisma.io",
     *     },
     *   },
     *   orderBy: {
     *     age: "asc",
     *   },
     *   take: 10,
     * })
    **/
    aggregate<T extends Agent_contractsAggregateArgs>(args: Subset<T, Agent_contractsAggregateArgs>): Prisma.PrismaPromise<GetAgent_contractsAggregateType<T>>

    /**
     * Group by Agent_contracts.
     * Note, that providing `undefined` is treated as the value not being there.
     * Read more here: https://pris.ly/d/null-undefined
     * @param {agent_contractsGroupByArgs} args - Group by arguments.
     * @example
     * // Group by city, order by createdAt, get count
     * const result = await prisma.user.groupBy({
     *   by: ['city', 'createdAt'],
     *   orderBy: {
     *     createdAt: true
     *   },
     *   _count: {
     *     _all: true
     *   },
     * })
     * 
    **/
    groupBy<
      T extends agent_contractsGroupByArgs,
      HasSelectOrTake extends Or<
        Extends<'skip', Keys<T>>,
        Extends<'take', Keys<T>>
      >,
      OrderByArg extends True extends HasSelectOrTake
        ? { orderBy: agent_contractsGroupByArgs['orderBy'] }
        : { orderBy?: agent_contractsGroupByArgs['orderBy'] },
      OrderFields extends ExcludeUnderscoreKeys<Keys<MaybeTupleToUnion<T['orderBy']>>>,
      ByFields extends MaybeTupleToUnion<T['by']>,
      ByValid extends Has<ByFields, OrderFields>,
      HavingFields extends GetHavingFields<T['having']>,
      HavingValid extends Has<ByFields, HavingFields>,
      ByEmpty extends T['by'] extends never[] ? True : False,
      InputErrors extends ByEmpty extends True
      ? `Error: "by" must not be empty.`
      : HavingValid extends False
      ? {
          [P in HavingFields]: P extends ByFields
            ? never
            : P extends string
            ? `Error: Field "${P}" used in "having" needs to be provided in "by".`
            : [
                Error,
                'Field ',
                P,
                ` in "having" needs to be provided in "by"`,
              ]
        }[HavingFields]
      : 'take' extends Keys<T>
      ? 'orderBy' extends Keys<T>
        ? ByValid extends True
          ? {}
          : {
              [P in OrderFields]: P extends ByFields
                ? never
                : `Error: Field "${P}" in "orderBy" needs to be provided in "by"`
            }[OrderFields]
        : 'Error: If you provide "take", you also need to provide "orderBy"'
      : 'skip' extends Keys<T>
      ? 'orderBy' extends Keys<T>
        ? ByValid extends True
          ? {}
          : {
              [P in OrderFields]: P extends ByFields
                ? never
                : `Error: Field "${P}" in "orderBy" needs to be provided in "by"`
            }[OrderFields]
        : 'Error: If you provide "skip", you also need to provide "orderBy"'
      : ByValid extends True
      ? {}
      : {
          [P in OrderFields]: P extends ByFields
            ? never
            : `Error: Field "${P}" in "orderBy" needs to be provided in "by"`
        }[OrderFields]
    >(args: SubsetIntersection<T, agent_contractsGroupByArgs, OrderByArg> & InputErrors): {} extends InputErrors ? GetAgent_contractsGroupByPayload<T> : Prisma.PrismaPromise<InputErrors>
  /**
   * Fields of the agent_contracts model
   */
  readonly fields: agent_contractsFieldRefs;
  }

  /**
   * The delegate class that acts as a "Promise-like" for agent_contracts.
   * Why is this prefixed with `Prisma__`?
   * Because we want to prevent naming conflicts as mentioned in
   * https://github.com/prisma/prisma-client-js/issues/707
   */
  export interface Prisma__agent_contractsClient<T, Null = never, ExtArgs extends $Extensions.InternalArgs = $Extensions.DefaultArgs> extends Prisma.PrismaPromise<T> {
    readonly [Symbol.toStringTag]: "PrismaPromise"
    /**
     * Attaches callbacks for the resolution and/or rejection of the Promise.
     * @param onfulfilled The callback to execute when the Promise is resolved.
     * @param onrejected The callback to execute when the Promise is rejected.
     * @returns A Promise for the completion of which ever callback is executed.
     */
    then<TResult1 = T, TResult2 = never>(onfulfilled?: ((value: T) => TResult1 | PromiseLike<TResult1>) | undefined | null, onrejected?: ((reason: any) => TResult2 | PromiseLike<TResult2>) | undefined | null): $Utils.JsPromise<TResult1 | TResult2>
    /**
     * Attaches a callback for only the rejection of the Promise.
     * @param onrejected The callback to execute when the Promise is rejected.
     * @returns A Promise for the completion of the callback.
     */
    catch<TResult = never>(onrejected?: ((reason: any) => TResult | PromiseLike<TResult>) | undefined | null): $Utils.JsPromise<T | TResult>
    /**
     * Attaches a callback that is invoked when the Promise is settled (fulfilled or rejected). The
     * resolved value cannot be modified from the callback.
     * @param onfinally The callback to execute when the Promise is settled (fulfilled or rejected).
     * @returns A Promise for the completion of the callback.
     */
    finally(onfinally?: (() => void) | undefined | null): $Utils.JsPromise<T>
  }




  /**
   * Fields of the agent_contracts model
   */ 
  interface agent_contractsFieldRefs {
    readonly id: FieldRef<"agent_contracts", 'String'>
    readonly agentId: FieldRef<"agent_contracts", 'String'>
    readonly stage: FieldRef<"agent_contracts", 'String'>
    readonly displayName: FieldRef<"agent_contracts", 'String'>
    readonly description: FieldRef<"agent_contracts", 'String'>
    readonly schemaVersion: FieldRef<"agent_contracts", 'String'>
    readonly source: FieldRef<"agent_contracts", 'String'>
    readonly managedByCode: FieldRef<"agent_contracts", 'Boolean'>
    readonly metadata: FieldRef<"agent_contracts", 'String'>
    readonly createdAt: FieldRef<"agent_contracts", 'DateTime'>
    readonly updatedAt: FieldRef<"agent_contracts", 'DateTime'>
  }
    

  // Custom InputTypes
  /**
   * agent_contracts findUnique
   */
  export type agent_contractsFindUniqueArgs<ExtArgs extends $Extensions.InternalArgs = $Extensions.DefaultArgs> = {
    /**
     * Select specific fields to fetch from the agent_contracts
     */
    select?: agent_contractsSelect<ExtArgs> | null
    /**
     * Filter, which agent_contracts to fetch.
     */
    where: agent_contractsWhereUniqueInput
  }

  /**
   * agent_contracts findUniqueOrThrow
   */
  export type agent_contractsFindUniqueOrThrowArgs<ExtArgs extends $Extensions.InternalArgs = $Extensions.DefaultArgs> = {
    /**
     * Select specific fields to fetch from the agent_contracts
     */
    select?: agent_contractsSelect<ExtArgs> | null
    /**
     * Filter, which agent_contracts to fetch.
     */
    where: agent_contractsWhereUniqueInput
  }

  /**
   * agent_contracts findFirst
   */
  export type agent_contractsFindFirstArgs<ExtArgs extends $Extensions.InternalArgs = $Extensions.DefaultArgs> = {
    /**
     * Select specific fields to fetch from the agent_contracts
     */
    select?: agent_contractsSelect<ExtArgs> | null
    /**
     * Filter, which agent_contracts to fetch.
     */
    where?: agent_contractsWhereInput
    /**
     * {@link https://www.prisma.io/docs/concepts/components/prisma-client/sorting Sorting Docs}
     * 
     * Determine the order of agent_contracts to fetch.
     */
    orderBy?: agent_contractsOrderByWithRelationInput | agent_contractsOrderByWithRelationInput[]
    /**
     * {@link https://www.prisma.io/docs/concepts/components/prisma-client/pagination#cursor-based-pagination Cursor Docs}
     * 
     * Sets the position for searching for agent_contracts.
     */
    cursor?: agent_contractsWhereUniqueInput
    /**
     * {@link https://www.prisma.io/docs/concepts/components/prisma-client/pagination Pagination Docs}
     * 
     * Take `±n` agent_contracts from the position of the cursor.
     */
    take?: number
    /**
     * {@link https://www.prisma.io/docs/concepts/components/prisma-client/pagination Pagination Docs}
     * 
     * Skip the first `n` agent_contracts.
     */
    skip?: number
    /**
     * {@link https://www.prisma.io/docs/concepts/components/prisma-client/distinct Distinct Docs}
     * 
     * Filter by unique combinations of agent_contracts.
     */
    distinct?: Agent_contractsScalarFieldEnum | Agent_contractsScalarFieldEnum[]
  }

  /**
   * agent_contracts findFirstOrThrow
   */
  export type agent_contractsFindFirstOrThrowArgs<ExtArgs extends $Extensions.InternalArgs = $Extensions.DefaultArgs> = {
    /**
     * Select specific fields to fetch from the agent_contracts
     */
    select?: agent_contractsSelect<ExtArgs> | null
    /**
     * Filter, which agent_contracts to fetch.
     */
    where?: agent_contractsWhereInput
    /**
     * {@link https://www.prisma.io/docs/concepts/components/prisma-client/sorting Sorting Docs}
     * 
     * Determine the order of agent_contracts to fetch.
     */
    orderBy?: agent_contractsOrderByWithRelationInput | agent_contractsOrderByWithRelationInput[]
    /**
     * {@link https://www.prisma.io/docs/concepts/components/prisma-client/pagination#cursor-based-pagination Cursor Docs}
     * 
     * Sets the position for searching for agent_contracts.
     */
    cursor?: agent_contractsWhereUniqueInput
    /**
     * {@link https://www.prisma.io/docs/concepts/components/prisma-client/pagination Pagination Docs}
     * 
     * Take `±n` agent_contracts from the position of the cursor.
     */
    take?: number
    /**
     * {@link https://www.prisma.io/docs/concepts/components/prisma-client/pagination Pagination Docs}
     * 
     * Skip the first `n` agent_contracts.
     */
    skip?: number
    /**
     * {@link https://www.prisma.io/docs/concepts/components/prisma-client/distinct Distinct Docs}
     * 
     * Filter by unique combinations of agent_contracts.
     */
    distinct?: Agent_contractsScalarFieldEnum | Agent_contractsScalarFieldEnum[]
  }

  /**
   * agent_contracts findMany
   */
  export type agent_contractsFindManyArgs<ExtArgs extends $Extensions.InternalArgs = $Extensions.DefaultArgs> = {
    /**
     * Select specific fields to fetch from the agent_contracts
     */
    select?: agent_contractsSelect<ExtArgs> | null
    /**
     * Filter, which agent_contracts to fetch.
     */
    where?: agent_contractsWhereInput
    /**
     * {@link https://www.prisma.io/docs/concepts/components/prisma-client/sorting Sorting Docs}
     * 
     * Determine the order of agent_contracts to fetch.
     */
    orderBy?: agent_contractsOrderByWithRelationInput | agent_contractsOrderByWithRelationInput[]
    /**
     * {@link https://www.prisma.io/docs/concepts/components/prisma-client/pagination#cursor-based-pagination Cursor Docs}
     * 
     * Sets the position for listing agent_contracts.
     */
    cursor?: agent_contractsWhereUniqueInput
    /**
     * {@link https://www.prisma.io/docs/concepts/components/prisma-client/pagination Pagination Docs}
     * 
     * Take `±n` agent_contracts from the position of the cursor.
     */
    take?: number
    /**
     * {@link https://www.prisma.io/docs/concepts/components/prisma-client/pagination Pagination Docs}
     * 
     * Skip the first `n` agent_contracts.
     */
    skip?: number
    distinct?: Agent_contractsScalarFieldEnum | Agent_contractsScalarFieldEnum[]
  }

  /**
   * agent_contracts create
   */
  export type agent_contractsCreateArgs<ExtArgs extends $Extensions.InternalArgs = $Extensions.DefaultArgs> = {
    /**
     * Select specific fields to fetch from the agent_contracts
     */
    select?: agent_contractsSelect<ExtArgs> | null
    /**
     * The data needed to create a agent_contracts.
     */
    data: XOR<agent_contractsCreateInput, agent_contractsUncheckedCreateInput>
  }

  /**
   * agent_contracts createMany
   */
  export type agent_contractsCreateManyArgs<ExtArgs extends $Extensions.InternalArgs = $Extensions.DefaultArgs> = {
    /**
     * The data used to create many agent_contracts.
     */
    data: agent_contractsCreateManyInput | agent_contractsCreateManyInput[]
  }

  /**
   * agent_contracts createManyAndReturn
   */
  export type agent_contractsCreateManyAndReturnArgs<ExtArgs extends $Extensions.InternalArgs = $Extensions.DefaultArgs> = {
    /**
     * Select specific fields to fetch from the agent_contracts
     */
    select?: agent_contractsSelectCreateManyAndReturn<ExtArgs> | null
    /**
     * The data used to create many agent_contracts.
     */
    data: agent_contractsCreateManyInput | agent_contractsCreateManyInput[]
  }

  /**
   * agent_contracts update
   */
  export type agent_contractsUpdateArgs<ExtArgs extends $Extensions.InternalArgs = $Extensions.DefaultArgs> = {
    /**
     * Select specific fields to fetch from the agent_contracts
     */
    select?: agent_contractsSelect<ExtArgs> | null
    /**
     * The data needed to update a agent_contracts.
     */
    data: XOR<agent_contractsUpdateInput, agent_contractsUncheckedUpdateInput>
    /**
     * Choose, which agent_contracts to update.
     */
    where: agent_contractsWhereUniqueInput
  }

  /**
   * agent_contracts updateMany
   */
  export type agent_contractsUpdateManyArgs<ExtArgs extends $Extensions.InternalArgs = $Extensions.DefaultArgs> = {
    /**
     * The data used to update agent_contracts.
     */
    data: XOR<agent_contractsUpdateManyMutationInput, agent_contractsUncheckedUpdateManyInput>
    /**
     * Filter which agent_contracts to update
     */
    where?: agent_contractsWhereInput
  }

  /**
   * agent_contracts upsert
   */
  export type agent_contractsUpsertArgs<ExtArgs extends $Extensions.InternalArgs = $Extensions.DefaultArgs> = {
    /**
     * Select specific fields to fetch from the agent_contracts
     */
    select?: agent_contractsSelect<ExtArgs> | null
    /**
     * The filter to search for the agent_contracts to update in case it exists.
     */
    where: agent_contractsWhereUniqueInput
    /**
     * In case the agent_contracts found by the `where` argument doesn't exist, create a new agent_contracts with this data.
     */
    create: XOR<agent_contractsCreateInput, agent_contractsUncheckedCreateInput>
    /**
     * In case the agent_contracts was found with the provided `where` argument, update it with this data.
     */
    update: XOR<agent_contractsUpdateInput, agent_contractsUncheckedUpdateInput>
  }

  /**
   * agent_contracts delete
   */
  export type agent_contractsDeleteArgs<ExtArgs extends $Extensions.InternalArgs = $Extensions.DefaultArgs> = {
    /**
     * Select specific fields to fetch from the agent_contracts
     */
    select?: agent_contractsSelect<ExtArgs> | null
    /**
     * Filter which agent_contracts to delete.
     */
    where: agent_contractsWhereUniqueInput
  }

  /**
   * agent_contracts deleteMany
   */
  export type agent_contractsDeleteManyArgs<ExtArgs extends $Extensions.InternalArgs = $Extensions.DefaultArgs> = {
    /**
     * Filter which agent_contracts to delete
     */
    where?: agent_contractsWhereInput
  }

  /**
   * agent_contracts without action
   */
  export type agent_contractsDefaultArgs<ExtArgs extends $Extensions.InternalArgs = $Extensions.DefaultArgs> = {
    /**
     * Select specific fields to fetch from the agent_contracts
     */
    select?: agent_contractsSelect<ExtArgs> | null
  }


  /**
   * Model agent_field_routings
   */

  export type AggregateAgent_field_routings = {
    _count: Agent_field_routingsCountAggregateOutputType | null
    _avg: Agent_field_routingsAvgAggregateOutputType | null
    _sum: Agent_field_routingsSumAggregateOutputType | null
    _min: Agent_field_routingsMinAggregateOutputType | null
    _max: Agent_field_routingsMaxAggregateOutputType | null
  }

  export type Agent_field_routingsAvgAggregateOutputType = {
    ordering: number | null
  }

  export type Agent_field_routingsSumAggregateOutputType = {
    ordering: number | null
  }

  export type Agent_field_routingsMinAggregateOutputType = {
    id: string | null
    agentId: string | null
    fieldId: string | null
    render: string | null
    handoff: string | null
    internalFlag: boolean | null
    accumulate: boolean | null
    visibilityPreset: string | null
    ordering: number | null
    notes: string | null
    source: string | null
    managedByCode: boolean | null
    systemLocked: boolean | null
    structureLocked: boolean | null
    createdAt: Date | null
    updatedAt: Date | null
  }

  export type Agent_field_routingsMaxAggregateOutputType = {
    id: string | null
    agentId: string | null
    fieldId: string | null
    render: string | null
    handoff: string | null
    internalFlag: boolean | null
    accumulate: boolean | null
    visibilityPreset: string | null
    ordering: number | null
    notes: string | null
    source: string | null
    managedByCode: boolean | null
    systemLocked: boolean | null
    structureLocked: boolean | null
    createdAt: Date | null
    updatedAt: Date | null
  }

  export type Agent_field_routingsCountAggregateOutputType = {
    id: number
    agentId: number
    fieldId: number
    render: number
    handoff: number
    internalFlag: number
    accumulate: number
    visibilityPreset: number
    ordering: number
    notes: number
    source: number
    managedByCode: number
    systemLocked: number
    structureLocked: number
    createdAt: number
    updatedAt: number
    _all: number
  }


  export type Agent_field_routingsAvgAggregateInputType = {
    ordering?: true
  }

  export type Agent_field_routingsSumAggregateInputType = {
    ordering?: true
  }

  export type Agent_field_routingsMinAggregateInputType = {
    id?: true
    agentId?: true
    fieldId?: true
    render?: true
    handoff?: true
    internalFlag?: true
    accumulate?: true
    visibilityPreset?: true
    ordering?: true
    notes?: true
    source?: true
    managedByCode?: true
    systemLocked?: true
    structureLocked?: true
    createdAt?: true
    updatedAt?: true
  }

  export type Agent_field_routingsMaxAggregateInputType = {
    id?: true
    agentId?: true
    fieldId?: true
    render?: true
    handoff?: true
    internalFlag?: true
    accumulate?: true
    visibilityPreset?: true
    ordering?: true
    notes?: true
    source?: true
    managedByCode?: true
    systemLocked?: true
    structureLocked?: true
    createdAt?: true
    updatedAt?: true
  }

  export type Agent_field_routingsCountAggregateInputType = {
    id?: true
    agentId?: true
    fieldId?: true
    render?: true
    handoff?: true
    internalFlag?: true
    accumulate?: true
    visibilityPreset?: true
    ordering?: true
    notes?: true
    source?: true
    managedByCode?: true
    systemLocked?: true
    structureLocked?: true
    createdAt?: true
    updatedAt?: true
    _all?: true
  }

  export type Agent_field_routingsAggregateArgs<ExtArgs extends $Extensions.InternalArgs = $Extensions.DefaultArgs> = {
    /**
     * Filter which agent_field_routings to aggregate.
     */
    where?: agent_field_routingsWhereInput
    /**
     * {@link https://www.prisma.io/docs/concepts/components/prisma-client/sorting Sorting Docs}
     * 
     * Determine the order of agent_field_routings to fetch.
     */
    orderBy?: agent_field_routingsOrderByWithRelationInput | agent_field_routingsOrderByWithRelationInput[]
    /**
     * {@link https://www.prisma.io/docs/concepts/components/prisma-client/pagination#cursor-based-pagination Cursor Docs}
     * 
     * Sets the start position
     */
    cursor?: agent_field_routingsWhereUniqueInput
    /**
     * {@link https://www.prisma.io/docs/concepts/components/prisma-client/pagination Pagination Docs}
     * 
     * Take `±n` agent_field_routings from the position of the cursor.
     */
    take?: number
    /**
     * {@link https://www.prisma.io/docs/concepts/components/prisma-client/pagination Pagination Docs}
     * 
     * Skip the first `n` agent_field_routings.
     */
    skip?: number
    /**
     * {@link https://www.prisma.io/docs/concepts/components/prisma-client/aggregations Aggregation Docs}
     * 
     * Count returned agent_field_routings
    **/
    _count?: true | Agent_field_routingsCountAggregateInputType
    /**
     * {@link https://www.prisma.io/docs/concepts/components/prisma-client/aggregations Aggregation Docs}
     * 
     * Select which fields to average
    **/
    _avg?: Agent_field_routingsAvgAggregateInputType
    /**
     * {@link https://www.prisma.io/docs/concepts/components/prisma-client/aggregations Aggregation Docs}
     * 
     * Select which fields to sum
    **/
    _sum?: Agent_field_routingsSumAggregateInputType
    /**
     * {@link https://www.prisma.io/docs/concepts/components/prisma-client/aggregations Aggregation Docs}
     * 
     * Select which fields to find the minimum value
    **/
    _min?: Agent_field_routingsMinAggregateInputType
    /**
     * {@link https://www.prisma.io/docs/concepts/components/prisma-client/aggregations Aggregation Docs}
     * 
     * Select which fields to find the maximum value
    **/
    _max?: Agent_field_routingsMaxAggregateInputType
  }

  export type GetAgent_field_routingsAggregateType<T extends Agent_field_routingsAggregateArgs> = {
        [P in keyof T & keyof AggregateAgent_field_routings]: P extends '_count' | 'count'
      ? T[P] extends true
        ? number
        : GetScalarType<T[P], AggregateAgent_field_routings[P]>
      : GetScalarType<T[P], AggregateAgent_field_routings[P]>
  }




  export type agent_field_routingsGroupByArgs<ExtArgs extends $Extensions.InternalArgs = $Extensions.DefaultArgs> = {
    where?: agent_field_routingsWhereInput
    orderBy?: agent_field_routingsOrderByWithAggregationInput | agent_field_routingsOrderByWithAggregationInput[]
    by: Agent_field_routingsScalarFieldEnum[] | Agent_field_routingsScalarFieldEnum
    having?: agent_field_routingsScalarWhereWithAggregatesInput
    take?: number
    skip?: number
    _count?: Agent_field_routingsCountAggregateInputType | true
    _avg?: Agent_field_routingsAvgAggregateInputType
    _sum?: Agent_field_routingsSumAggregateInputType
    _min?: Agent_field_routingsMinAggregateInputType
    _max?: Agent_field_routingsMaxAggregateInputType
  }

  export type Agent_field_routingsGroupByOutputType = {
    id: string
    agentId: string
    fieldId: string
    render: string
    handoff: string | null
    internalFlag: boolean
    accumulate: boolean
    visibilityPreset: string | null
    ordering: number
    notes: string | null
    source: string
    managedByCode: boolean
    systemLocked: boolean
    structureLocked: boolean
    createdAt: Date
    updatedAt: Date
    _count: Agent_field_routingsCountAggregateOutputType | null
    _avg: Agent_field_routingsAvgAggregateOutputType | null
    _sum: Agent_field_routingsSumAggregateOutputType | null
    _min: Agent_field_routingsMinAggregateOutputType | null
    _max: Agent_field_routingsMaxAggregateOutputType | null
  }

  type GetAgent_field_routingsGroupByPayload<T extends agent_field_routingsGroupByArgs> = Prisma.PrismaPromise<
    Array<
      PickEnumerable<Agent_field_routingsGroupByOutputType, T['by']> &
        {
          [P in ((keyof T) & (keyof Agent_field_routingsGroupByOutputType))]: P extends '_count'
            ? T[P] extends boolean
              ? number
              : GetScalarType<T[P], Agent_field_routingsGroupByOutputType[P]>
            : GetScalarType<T[P], Agent_field_routingsGroupByOutputType[P]>
        }
      >
    >


  export type agent_field_routingsSelect<ExtArgs extends $Extensions.InternalArgs = $Extensions.DefaultArgs> = $Extensions.GetSelect<{
    id?: boolean
    agentId?: boolean
    fieldId?: boolean
    render?: boolean
    handoff?: boolean
    internalFlag?: boolean
    accumulate?: boolean
    visibilityPreset?: boolean
    ordering?: boolean
    notes?: boolean
    source?: boolean
    managedByCode?: boolean
    systemLocked?: boolean
    structureLocked?: boolean
    createdAt?: boolean
    updatedAt?: boolean
  }, ExtArgs["result"]["agent_field_routings"]>

  export type agent_field_routingsSelectCreateManyAndReturn<ExtArgs extends $Extensions.InternalArgs = $Extensions.DefaultArgs> = $Extensions.GetSelect<{
    id?: boolean
    agentId?: boolean
    fieldId?: boolean
    render?: boolean
    handoff?: boolean
    internalFlag?: boolean
    accumulate?: boolean
    visibilityPreset?: boolean
    ordering?: boolean
    notes?: boolean
    source?: boolean
    managedByCode?: boolean
    systemLocked?: boolean
    structureLocked?: boolean
    createdAt?: boolean
    updatedAt?: boolean
  }, ExtArgs["result"]["agent_field_routings"]>

  export type agent_field_routingsSelectScalar = {
    id?: boolean
    agentId?: boolean
    fieldId?: boolean
    render?: boolean
    handoff?: boolean
    internalFlag?: boolean
    accumulate?: boolean
    visibilityPreset?: boolean
    ordering?: boolean
    notes?: boolean
    source?: boolean
    managedByCode?: boolean
    systemLocked?: boolean
    structureLocked?: boolean
    createdAt?: boolean
    updatedAt?: boolean
  }


  export type $agent_field_routingsPayload<ExtArgs extends $Extensions.InternalArgs = $Extensions.DefaultArgs> = {
    name: "agent_field_routings"
    objects: {}
    scalars: $Extensions.GetPayloadResult<{
      id: string
      agentId: string
      fieldId: string
      render: string
      handoff: string | null
      internalFlag: boolean
      accumulate: boolean
      visibilityPreset: string | null
      ordering: number
      notes: string | null
      source: string
      managedByCode: boolean
      systemLocked: boolean
      structureLocked: boolean
      createdAt: Date
      updatedAt: Date
    }, ExtArgs["result"]["agent_field_routings"]>
    composites: {}
  }

  type agent_field_routingsGetPayload<S extends boolean | null | undefined | agent_field_routingsDefaultArgs> = $Result.GetResult<Prisma.$agent_field_routingsPayload, S>

  type agent_field_routingsCountArgs<ExtArgs extends $Extensions.InternalArgs = $Extensions.DefaultArgs> = 
    Omit<agent_field_routingsFindManyArgs, 'select' | 'include' | 'distinct'> & {
      select?: Agent_field_routingsCountAggregateInputType | true
    }

  export interface agent_field_routingsDelegate<ExtArgs extends $Extensions.InternalArgs = $Extensions.DefaultArgs> {
    [K: symbol]: { types: Prisma.TypeMap<ExtArgs>['model']['agent_field_routings'], meta: { name: 'agent_field_routings' } }
    /**
     * Find zero or one Agent_field_routings that matches the filter.
     * @param {agent_field_routingsFindUniqueArgs} args - Arguments to find a Agent_field_routings
     * @example
     * // Get one Agent_field_routings
     * const agent_field_routings = await prisma.agent_field_routings.findUnique({
     *   where: {
     *     // ... provide filter here
     *   }
     * })
     */
    findUnique<T extends agent_field_routingsFindUniqueArgs>(args: SelectSubset<T, agent_field_routingsFindUniqueArgs<ExtArgs>>): Prisma__agent_field_routingsClient<$Result.GetResult<Prisma.$agent_field_routingsPayload<ExtArgs>, T, "findUnique"> | null, null, ExtArgs>

    /**
     * Find one Agent_field_routings that matches the filter or throw an error with `error.code='P2025'` 
     * if no matches were found.
     * @param {agent_field_routingsFindUniqueOrThrowArgs} args - Arguments to find a Agent_field_routings
     * @example
     * // Get one Agent_field_routings
     * const agent_field_routings = await prisma.agent_field_routings.findUniqueOrThrow({
     *   where: {
     *     // ... provide filter here
     *   }
     * })
     */
    findUniqueOrThrow<T extends agent_field_routingsFindUniqueOrThrowArgs>(args: SelectSubset<T, agent_field_routingsFindUniqueOrThrowArgs<ExtArgs>>): Prisma__agent_field_routingsClient<$Result.GetResult<Prisma.$agent_field_routingsPayload<ExtArgs>, T, "findUniqueOrThrow">, never, ExtArgs>

    /**
     * Find the first Agent_field_routings that matches the filter.
     * Note, that providing `undefined` is treated as the value not being there.
     * Read more here: https://pris.ly/d/null-undefined
     * @param {agent_field_routingsFindFirstArgs} args - Arguments to find a Agent_field_routings
     * @example
     * // Get one Agent_field_routings
     * const agent_field_routings = await prisma.agent_field_routings.findFirst({
     *   where: {
     *     // ... provide filter here
     *   }
     * })
     */
    findFirst<T extends agent_field_routingsFindFirstArgs>(args?: SelectSubset<T, agent_field_routingsFindFirstArgs<ExtArgs>>): Prisma__agent_field_routingsClient<$Result.GetResult<Prisma.$agent_field_routingsPayload<ExtArgs>, T, "findFirst"> | null, null, ExtArgs>

    /**
     * Find the first Agent_field_routings that matches the filter or
     * throw `PrismaKnownClientError` with `P2025` code if no matches were found.
     * Note, that providing `undefined` is treated as the value not being there.
     * Read more here: https://pris.ly/d/null-undefined
     * @param {agent_field_routingsFindFirstOrThrowArgs} args - Arguments to find a Agent_field_routings
     * @example
     * // Get one Agent_field_routings
     * const agent_field_routings = await prisma.agent_field_routings.findFirstOrThrow({
     *   where: {
     *     // ... provide filter here
     *   }
     * })
     */
    findFirstOrThrow<T extends agent_field_routingsFindFirstOrThrowArgs>(args?: SelectSubset<T, agent_field_routingsFindFirstOrThrowArgs<ExtArgs>>): Prisma__agent_field_routingsClient<$Result.GetResult<Prisma.$agent_field_routingsPayload<ExtArgs>, T, "findFirstOrThrow">, never, ExtArgs>

    /**
     * Find zero or more Agent_field_routings that matches the filter.
     * Note, that providing `undefined` is treated as the value not being there.
     * Read more here: https://pris.ly/d/null-undefined
     * @param {agent_field_routingsFindManyArgs} args - Arguments to filter and select certain fields only.
     * @example
     * // Get all Agent_field_routings
     * const agent_field_routings = await prisma.agent_field_routings.findMany()
     * 
     * // Get first 10 Agent_field_routings
     * const agent_field_routings = await prisma.agent_field_routings.findMany({ take: 10 })
     * 
     * // Only select the `id`
     * const agent_field_routingsWithIdOnly = await prisma.agent_field_routings.findMany({ select: { id: true } })
     * 
     */
    findMany<T extends agent_field_routingsFindManyArgs>(args?: SelectSubset<T, agent_field_routingsFindManyArgs<ExtArgs>>): Prisma.PrismaPromise<$Result.GetResult<Prisma.$agent_field_routingsPayload<ExtArgs>, T, "findMany">>

    /**
     * Create a Agent_field_routings.
     * @param {agent_field_routingsCreateArgs} args - Arguments to create a Agent_field_routings.
     * @example
     * // Create one Agent_field_routings
     * const Agent_field_routings = await prisma.agent_field_routings.create({
     *   data: {
     *     // ... data to create a Agent_field_routings
     *   }
     * })
     * 
     */
    create<T extends agent_field_routingsCreateArgs>(args: SelectSubset<T, agent_field_routingsCreateArgs<ExtArgs>>): Prisma__agent_field_routingsClient<$Result.GetResult<Prisma.$agent_field_routingsPayload<ExtArgs>, T, "create">, never, ExtArgs>

    /**
     * Create many Agent_field_routings.
     * @param {agent_field_routingsCreateManyArgs} args - Arguments to create many Agent_field_routings.
     * @example
     * // Create many Agent_field_routings
     * const agent_field_routings = await prisma.agent_field_routings.createMany({
     *   data: [
     *     // ... provide data here
     *   ]
     * })
     *     
     */
    createMany<T extends agent_field_routingsCreateManyArgs>(args?: SelectSubset<T, agent_field_routingsCreateManyArgs<ExtArgs>>): Prisma.PrismaPromise<BatchPayload>

    /**
     * Create many Agent_field_routings and returns the data saved in the database.
     * @param {agent_field_routingsCreateManyAndReturnArgs} args - Arguments to create many Agent_field_routings.
     * @example
     * // Create many Agent_field_routings
     * const agent_field_routings = await prisma.agent_field_routings.createManyAndReturn({
     *   data: [
     *     // ... provide data here
     *   ]
     * })
     * 
     * // Create many Agent_field_routings and only return the `id`
     * const agent_field_routingsWithIdOnly = await prisma.agent_field_routings.createManyAndReturn({ 
     *   select: { id: true },
     *   data: [
     *     // ... provide data here
     *   ]
     * })
     * Note, that providing `undefined` is treated as the value not being there.
     * Read more here: https://pris.ly/d/null-undefined
     * 
     */
    createManyAndReturn<T extends agent_field_routingsCreateManyAndReturnArgs>(args?: SelectSubset<T, agent_field_routingsCreateManyAndReturnArgs<ExtArgs>>): Prisma.PrismaPromise<$Result.GetResult<Prisma.$agent_field_routingsPayload<ExtArgs>, T, "createManyAndReturn">>

    /**
     * Delete a Agent_field_routings.
     * @param {agent_field_routingsDeleteArgs} args - Arguments to delete one Agent_field_routings.
     * @example
     * // Delete one Agent_field_routings
     * const Agent_field_routings = await prisma.agent_field_routings.delete({
     *   where: {
     *     // ... filter to delete one Agent_field_routings
     *   }
     * })
     * 
     */
    delete<T extends agent_field_routingsDeleteArgs>(args: SelectSubset<T, agent_field_routingsDeleteArgs<ExtArgs>>): Prisma__agent_field_routingsClient<$Result.GetResult<Prisma.$agent_field_routingsPayload<ExtArgs>, T, "delete">, never, ExtArgs>

    /**
     * Update one Agent_field_routings.
     * @param {agent_field_routingsUpdateArgs} args - Arguments to update one Agent_field_routings.
     * @example
     * // Update one Agent_field_routings
     * const agent_field_routings = await prisma.agent_field_routings.update({
     *   where: {
     *     // ... provide filter here
     *   },
     *   data: {
     *     // ... provide data here
     *   }
     * })
     * 
     */
    update<T extends agent_field_routingsUpdateArgs>(args: SelectSubset<T, agent_field_routingsUpdateArgs<ExtArgs>>): Prisma__agent_field_routingsClient<$Result.GetResult<Prisma.$agent_field_routingsPayload<ExtArgs>, T, "update">, never, ExtArgs>

    /**
     * Delete zero or more Agent_field_routings.
     * @param {agent_field_routingsDeleteManyArgs} args - Arguments to filter Agent_field_routings to delete.
     * @example
     * // Delete a few Agent_field_routings
     * const { count } = await prisma.agent_field_routings.deleteMany({
     *   where: {
     *     // ... provide filter here
     *   }
     * })
     * 
     */
    deleteMany<T extends agent_field_routingsDeleteManyArgs>(args?: SelectSubset<T, agent_field_routingsDeleteManyArgs<ExtArgs>>): Prisma.PrismaPromise<BatchPayload>

    /**
     * Update zero or more Agent_field_routings.
     * Note, that providing `undefined` is treated as the value not being there.
     * Read more here: https://pris.ly/d/null-undefined
     * @param {agent_field_routingsUpdateManyArgs} args - Arguments to update one or more rows.
     * @example
     * // Update many Agent_field_routings
     * const agent_field_routings = await prisma.agent_field_routings.updateMany({
     *   where: {
     *     // ... provide filter here
     *   },
     *   data: {
     *     // ... provide data here
     *   }
     * })
     * 
     */
    updateMany<T extends agent_field_routingsUpdateManyArgs>(args: SelectSubset<T, agent_field_routingsUpdateManyArgs<ExtArgs>>): Prisma.PrismaPromise<BatchPayload>

    /**
     * Create or update one Agent_field_routings.
     * @param {agent_field_routingsUpsertArgs} args - Arguments to update or create a Agent_field_routings.
     * @example
     * // Update or create a Agent_field_routings
     * const agent_field_routings = await prisma.agent_field_routings.upsert({
     *   create: {
     *     // ... data to create a Agent_field_routings
     *   },
     *   update: {
     *     // ... in case it already exists, update
     *   },
     *   where: {
     *     // ... the filter for the Agent_field_routings we want to update
     *   }
     * })
     */
    upsert<T extends agent_field_routingsUpsertArgs>(args: SelectSubset<T, agent_field_routingsUpsertArgs<ExtArgs>>): Prisma__agent_field_routingsClient<$Result.GetResult<Prisma.$agent_field_routingsPayload<ExtArgs>, T, "upsert">, never, ExtArgs>


    /**
     * Count the number of Agent_field_routings.
     * Note, that providing `undefined` is treated as the value not being there.
     * Read more here: https://pris.ly/d/null-undefined
     * @param {agent_field_routingsCountArgs} args - Arguments to filter Agent_field_routings to count.
     * @example
     * // Count the number of Agent_field_routings
     * const count = await prisma.agent_field_routings.count({
     *   where: {
     *     // ... the filter for the Agent_field_routings we want to count
     *   }
     * })
    **/
    count<T extends agent_field_routingsCountArgs>(
      args?: Subset<T, agent_field_routingsCountArgs>,
    ): Prisma.PrismaPromise<
      T extends $Utils.Record<'select', any>
        ? T['select'] extends true
          ? number
          : GetScalarType<T['select'], Agent_field_routingsCountAggregateOutputType>
        : number
    >

    /**
     * Allows you to perform aggregations operations on a Agent_field_routings.
     * Note, that providing `undefined` is treated as the value not being there.
     * Read more here: https://pris.ly/d/null-undefined
     * @param {Agent_field_routingsAggregateArgs} args - Select which aggregations you would like to apply and on what fields.
     * @example
     * // Ordered by age ascending
     * // Where email contains prisma.io
     * // Limited to the 10 users
     * const aggregations = await prisma.user.aggregate({
     *   _avg: {
     *     age: true,
     *   },
     *   where: {
     *     email: {
     *       contains: "prisma.io",
     *     },
     *   },
     *   orderBy: {
     *     age: "asc",
     *   },
     *   take: 10,
     * })
    **/
    aggregate<T extends Agent_field_routingsAggregateArgs>(args: Subset<T, Agent_field_routingsAggregateArgs>): Prisma.PrismaPromise<GetAgent_field_routingsAggregateType<T>>

    /**
     * Group by Agent_field_routings.
     * Note, that providing `undefined` is treated as the value not being there.
     * Read more here: https://pris.ly/d/null-undefined
     * @param {agent_field_routingsGroupByArgs} args - Group by arguments.
     * @example
     * // Group by city, order by createdAt, get count
     * const result = await prisma.user.groupBy({
     *   by: ['city', 'createdAt'],
     *   orderBy: {
     *     createdAt: true
     *   },
     *   _count: {
     *     _all: true
     *   },
     * })
     * 
    **/
    groupBy<
      T extends agent_field_routingsGroupByArgs,
      HasSelectOrTake extends Or<
        Extends<'skip', Keys<T>>,
        Extends<'take', Keys<T>>
      >,
      OrderByArg extends True extends HasSelectOrTake
        ? { orderBy: agent_field_routingsGroupByArgs['orderBy'] }
        : { orderBy?: agent_field_routingsGroupByArgs['orderBy'] },
      OrderFields extends ExcludeUnderscoreKeys<Keys<MaybeTupleToUnion<T['orderBy']>>>,
      ByFields extends MaybeTupleToUnion<T['by']>,
      ByValid extends Has<ByFields, OrderFields>,
      HavingFields extends GetHavingFields<T['having']>,
      HavingValid extends Has<ByFields, HavingFields>,
      ByEmpty extends T['by'] extends never[] ? True : False,
      InputErrors extends ByEmpty extends True
      ? `Error: "by" must not be empty.`
      : HavingValid extends False
      ? {
          [P in HavingFields]: P extends ByFields
            ? never
            : P extends string
            ? `Error: Field "${P}" used in "having" needs to be provided in "by".`
            : [
                Error,
                'Field ',
                P,
                ` in "having" needs to be provided in "by"`,
              ]
        }[HavingFields]
      : 'take' extends Keys<T>
      ? 'orderBy' extends Keys<T>
        ? ByValid extends True
          ? {}
          : {
              [P in OrderFields]: P extends ByFields
                ? never
                : `Error: Field "${P}" in "orderBy" needs to be provided in "by"`
            }[OrderFields]
        : 'Error: If you provide "take", you also need to provide "orderBy"'
      : 'skip' extends Keys<T>
      ? 'orderBy' extends Keys<T>
        ? ByValid extends True
          ? {}
          : {
              [P in OrderFields]: P extends ByFields
                ? never
                : `Error: Field "${P}" in "orderBy" needs to be provided in "by"`
            }[OrderFields]
        : 'Error: If you provide "skip", you also need to provide "orderBy"'
      : ByValid extends True
      ? {}
      : {
          [P in OrderFields]: P extends ByFields
            ? never
            : `Error: Field "${P}" in "orderBy" needs to be provided in "by"`
        }[OrderFields]
    >(args: SubsetIntersection<T, agent_field_routingsGroupByArgs, OrderByArg> & InputErrors): {} extends InputErrors ? GetAgent_field_routingsGroupByPayload<T> : Prisma.PrismaPromise<InputErrors>
  /**
   * Fields of the agent_field_routings model
   */
  readonly fields: agent_field_routingsFieldRefs;
  }

  /**
   * The delegate class that acts as a "Promise-like" for agent_field_routings.
   * Why is this prefixed with `Prisma__`?
   * Because we want to prevent naming conflicts as mentioned in
   * https://github.com/prisma/prisma-client-js/issues/707
   */
  export interface Prisma__agent_field_routingsClient<T, Null = never, ExtArgs extends $Extensions.InternalArgs = $Extensions.DefaultArgs> extends Prisma.PrismaPromise<T> {
    readonly [Symbol.toStringTag]: "PrismaPromise"
    /**
     * Attaches callbacks for the resolution and/or rejection of the Promise.
     * @param onfulfilled The callback to execute when the Promise is resolved.
     * @param onrejected The callback to execute when the Promise is rejected.
     * @returns A Promise for the completion of which ever callback is executed.
     */
    then<TResult1 = T, TResult2 = never>(onfulfilled?: ((value: T) => TResult1 | PromiseLike<TResult1>) | undefined | null, onrejected?: ((reason: any) => TResult2 | PromiseLike<TResult2>) | undefined | null): $Utils.JsPromise<TResult1 | TResult2>
    /**
     * Attaches a callback for only the rejection of the Promise.
     * @param onrejected The callback to execute when the Promise is rejected.
     * @returns A Promise for the completion of the callback.
     */
    catch<TResult = never>(onrejected?: ((reason: any) => TResult | PromiseLike<TResult>) | undefined | null): $Utils.JsPromise<T | TResult>
    /**
     * Attaches a callback that is invoked when the Promise is settled (fulfilled or rejected). The
     * resolved value cannot be modified from the callback.
     * @param onfinally The callback to execute when the Promise is settled (fulfilled or rejected).
     * @returns A Promise for the completion of the callback.
     */
    finally(onfinally?: (() => void) | undefined | null): $Utils.JsPromise<T>
  }




  /**
   * Fields of the agent_field_routings model
   */ 
  interface agent_field_routingsFieldRefs {
    readonly id: FieldRef<"agent_field_routings", 'String'>
    readonly agentId: FieldRef<"agent_field_routings", 'String'>
    readonly fieldId: FieldRef<"agent_field_routings", 'String'>
    readonly render: FieldRef<"agent_field_routings", 'String'>
    readonly handoff: FieldRef<"agent_field_routings", 'String'>
    readonly internalFlag: FieldRef<"agent_field_routings", 'Boolean'>
    readonly accumulate: FieldRef<"agent_field_routings", 'Boolean'>
    readonly visibilityPreset: FieldRef<"agent_field_routings", 'String'>
    readonly ordering: FieldRef<"agent_field_routings", 'Int'>
    readonly notes: FieldRef<"agent_field_routings", 'String'>
    readonly source: FieldRef<"agent_field_routings", 'String'>
    readonly managedByCode: FieldRef<"agent_field_routings", 'Boolean'>
    readonly systemLocked: FieldRef<"agent_field_routings", 'Boolean'>
    readonly structureLocked: FieldRef<"agent_field_routings", 'Boolean'>
    readonly createdAt: FieldRef<"agent_field_routings", 'DateTime'>
    readonly updatedAt: FieldRef<"agent_field_routings", 'DateTime'>
  }
    

  // Custom InputTypes
  /**
   * agent_field_routings findUnique
   */
  export type agent_field_routingsFindUniqueArgs<ExtArgs extends $Extensions.InternalArgs = $Extensions.DefaultArgs> = {
    /**
     * Select specific fields to fetch from the agent_field_routings
     */
    select?: agent_field_routingsSelect<ExtArgs> | null
    /**
     * Filter, which agent_field_routings to fetch.
     */
    where: agent_field_routingsWhereUniqueInput
  }

  /**
   * agent_field_routings findUniqueOrThrow
   */
  export type agent_field_routingsFindUniqueOrThrowArgs<ExtArgs extends $Extensions.InternalArgs = $Extensions.DefaultArgs> = {
    /**
     * Select specific fields to fetch from the agent_field_routings
     */
    select?: agent_field_routingsSelect<ExtArgs> | null
    /**
     * Filter, which agent_field_routings to fetch.
     */
    where: agent_field_routingsWhereUniqueInput
  }

  /**
   * agent_field_routings findFirst
   */
  export type agent_field_routingsFindFirstArgs<ExtArgs extends $Extensions.InternalArgs = $Extensions.DefaultArgs> = {
    /**
     * Select specific fields to fetch from the agent_field_routings
     */
    select?: agent_field_routingsSelect<ExtArgs> | null
    /**
     * Filter, which agent_field_routings to fetch.
     */
    where?: agent_field_routingsWhereInput
    /**
     * {@link https://www.prisma.io/docs/concepts/components/prisma-client/sorting Sorting Docs}
     * 
     * Determine the order of agent_field_routings to fetch.
     */
    orderBy?: agent_field_routingsOrderByWithRelationInput | agent_field_routingsOrderByWithRelationInput[]
    /**
     * {@link https://www.prisma.io/docs/concepts/components/prisma-client/pagination#cursor-based-pagination Cursor Docs}
     * 
     * Sets the position for searching for agent_field_routings.
     */
    cursor?: agent_field_routingsWhereUniqueInput
    /**
     * {@link https://www.prisma.io/docs/concepts/components/prisma-client/pagination Pagination Docs}
     * 
     * Take `±n` agent_field_routings from the position of the cursor.
     */
    take?: number
    /**
     * {@link https://www.prisma.io/docs/concepts/components/prisma-client/pagination Pagination Docs}
     * 
     * Skip the first `n` agent_field_routings.
     */
    skip?: number
    /**
     * {@link https://www.prisma.io/docs/concepts/components/prisma-client/distinct Distinct Docs}
     * 
     * Filter by unique combinations of agent_field_routings.
     */
    distinct?: Agent_field_routingsScalarFieldEnum | Agent_field_routingsScalarFieldEnum[]
  }

  /**
   * agent_field_routings findFirstOrThrow
   */
  export type agent_field_routingsFindFirstOrThrowArgs<ExtArgs extends $Extensions.InternalArgs = $Extensions.DefaultArgs> = {
    /**
     * Select specific fields to fetch from the agent_field_routings
     */
    select?: agent_field_routingsSelect<ExtArgs> | null
    /**
     * Filter, which agent_field_routings to fetch.
     */
    where?: agent_field_routingsWhereInput
    /**
     * {@link https://www.prisma.io/docs/concepts/components/prisma-client/sorting Sorting Docs}
     * 
     * Determine the order of agent_field_routings to fetch.
     */
    orderBy?: agent_field_routingsOrderByWithRelationInput | agent_field_routingsOrderByWithRelationInput[]
    /**
     * {@link https://www.prisma.io/docs/concepts/components/prisma-client/pagination#cursor-based-pagination Cursor Docs}
     * 
     * Sets the position for searching for agent_field_routings.
     */
    cursor?: agent_field_routingsWhereUniqueInput
    /**
     * {@link https://www.prisma.io/docs/concepts/components/prisma-client/pagination Pagination Docs}
     * 
     * Take `±n` agent_field_routings from the position of the cursor.
     */
    take?: number
    /**
     * {@link https://www.prisma.io/docs/concepts/components/prisma-client/pagination Pagination Docs}
     * 
     * Skip the first `n` agent_field_routings.
     */
    skip?: number
    /**
     * {@link https://www.prisma.io/docs/concepts/components/prisma-client/distinct Distinct Docs}
     * 
     * Filter by unique combinations of agent_field_routings.
     */
    distinct?: Agent_field_routingsScalarFieldEnum | Agent_field_routingsScalarFieldEnum[]
  }

  /**
   * agent_field_routings findMany
   */
  export type agent_field_routingsFindManyArgs<ExtArgs extends $Extensions.InternalArgs = $Extensions.DefaultArgs> = {
    /**
     * Select specific fields to fetch from the agent_field_routings
     */
    select?: agent_field_routingsSelect<ExtArgs> | null
    /**
     * Filter, which agent_field_routings to fetch.
     */
    where?: agent_field_routingsWhereInput
    /**
     * {@link https://www.prisma.io/docs/concepts/components/prisma-client/sorting Sorting Docs}
     * 
     * Determine the order of agent_field_routings to fetch.
     */
    orderBy?: agent_field_routingsOrderByWithRelationInput | agent_field_routingsOrderByWithRelationInput[]
    /**
     * {@link https://www.prisma.io/docs/concepts/components/prisma-client/pagination#cursor-based-pagination Cursor Docs}
     * 
     * Sets the position for listing agent_field_routings.
     */
    cursor?: agent_field_routingsWhereUniqueInput
    /**
     * {@link https://www.prisma.io/docs/concepts/components/prisma-client/pagination Pagination Docs}
     * 
     * Take `±n` agent_field_routings from the position of the cursor.
     */
    take?: number
    /**
     * {@link https://www.prisma.io/docs/concepts/components/prisma-client/pagination Pagination Docs}
     * 
     * Skip the first `n` agent_field_routings.
     */
    skip?: number
    distinct?: Agent_field_routingsScalarFieldEnum | Agent_field_routingsScalarFieldEnum[]
  }

  /**
   * agent_field_routings create
   */
  export type agent_field_routingsCreateArgs<ExtArgs extends $Extensions.InternalArgs = $Extensions.DefaultArgs> = {
    /**
     * Select specific fields to fetch from the agent_field_routings
     */
    select?: agent_field_routingsSelect<ExtArgs> | null
    /**
     * The data needed to create a agent_field_routings.
     */
    data: XOR<agent_field_routingsCreateInput, agent_field_routingsUncheckedCreateInput>
  }

  /**
   * agent_field_routings createMany
   */
  export type agent_field_routingsCreateManyArgs<ExtArgs extends $Extensions.InternalArgs = $Extensions.DefaultArgs> = {
    /**
     * The data used to create many agent_field_routings.
     */
    data: agent_field_routingsCreateManyInput | agent_field_routingsCreateManyInput[]
  }

  /**
   * agent_field_routings createManyAndReturn
   */
  export type agent_field_routingsCreateManyAndReturnArgs<ExtArgs extends $Extensions.InternalArgs = $Extensions.DefaultArgs> = {
    /**
     * Select specific fields to fetch from the agent_field_routings
     */
    select?: agent_field_routingsSelectCreateManyAndReturn<ExtArgs> | null
    /**
     * The data used to create many agent_field_routings.
     */
    data: agent_field_routingsCreateManyInput | agent_field_routingsCreateManyInput[]
  }

  /**
   * agent_field_routings update
   */
  export type agent_field_routingsUpdateArgs<ExtArgs extends $Extensions.InternalArgs = $Extensions.DefaultArgs> = {
    /**
     * Select specific fields to fetch from the agent_field_routings
     */
    select?: agent_field_routingsSelect<ExtArgs> | null
    /**
     * The data needed to update a agent_field_routings.
     */
    data: XOR<agent_field_routingsUpdateInput, agent_field_routingsUncheckedUpdateInput>
    /**
     * Choose, which agent_field_routings to update.
     */
    where: agent_field_routingsWhereUniqueInput
  }

  /**
   * agent_field_routings updateMany
   */
  export type agent_field_routingsUpdateManyArgs<ExtArgs extends $Extensions.InternalArgs = $Extensions.DefaultArgs> = {
    /**
     * The data used to update agent_field_routings.
     */
    data: XOR<agent_field_routingsUpdateManyMutationInput, agent_field_routingsUncheckedUpdateManyInput>
    /**
     * Filter which agent_field_routings to update
     */
    where?: agent_field_routingsWhereInput
  }

  /**
   * agent_field_routings upsert
   */
  export type agent_field_routingsUpsertArgs<ExtArgs extends $Extensions.InternalArgs = $Extensions.DefaultArgs> = {
    /**
     * Select specific fields to fetch from the agent_field_routings
     */
    select?: agent_field_routingsSelect<ExtArgs> | null
    /**
     * The filter to search for the agent_field_routings to update in case it exists.
     */
    where: agent_field_routingsWhereUniqueInput
    /**
     * In case the agent_field_routings found by the `where` argument doesn't exist, create a new agent_field_routings with this data.
     */
    create: XOR<agent_field_routingsCreateInput, agent_field_routingsUncheckedCreateInput>
    /**
     * In case the agent_field_routings was found with the provided `where` argument, update it with this data.
     */
    update: XOR<agent_field_routingsUpdateInput, agent_field_routingsUncheckedUpdateInput>
  }

  /**
   * agent_field_routings delete
   */
  export type agent_field_routingsDeleteArgs<ExtArgs extends $Extensions.InternalArgs = $Extensions.DefaultArgs> = {
    /**
     * Select specific fields to fetch from the agent_field_routings
     */
    select?: agent_field_routingsSelect<ExtArgs> | null
    /**
     * Filter which agent_field_routings to delete.
     */
    where: agent_field_routingsWhereUniqueInput
  }

  /**
   * agent_field_routings deleteMany
   */
  export type agent_field_routingsDeleteManyArgs<ExtArgs extends $Extensions.InternalArgs = $Extensions.DefaultArgs> = {
    /**
     * Filter which agent_field_routings to delete
     */
    where?: agent_field_routingsWhereInput
  }

  /**
   * agent_field_routings without action
   */
  export type agent_field_routingsDefaultArgs<ExtArgs extends $Extensions.InternalArgs = $Extensions.DefaultArgs> = {
    /**
     * Select specific fields to fetch from the agent_field_routings
     */
    select?: agent_field_routingsSelect<ExtArgs> | null
  }


  /**
   * Model node_config_changes
   */

  export type AggregateNode_config_changes = {
    _count: Node_config_changesCountAggregateOutputType | null
    _min: Node_config_changesMinAggregateOutputType | null
    _max: Node_config_changesMaxAggregateOutputType | null
  }

  export type Node_config_changesMinAggregateOutputType = {
    id: string | null
    changeType: string | null
    targetTable: string | null
    targetId: string | null
    agentId: string | null
    fieldId: string | null
    before: string | null
    after: string | null
    actorId: string | null
    actorRole: string | null
    reason: string | null
    createdAt: Date | null
  }

  export type Node_config_changesMaxAggregateOutputType = {
    id: string | null
    changeType: string | null
    targetTable: string | null
    targetId: string | null
    agentId: string | null
    fieldId: string | null
    before: string | null
    after: string | null
    actorId: string | null
    actorRole: string | null
    reason: string | null
    createdAt: Date | null
  }

  export type Node_config_changesCountAggregateOutputType = {
    id: number
    changeType: number
    targetTable: number
    targetId: number
    agentId: number
    fieldId: number
    before: number
    after: number
    actorId: number
    actorRole: number
    reason: number
    createdAt: number
    _all: number
  }


  export type Node_config_changesMinAggregateInputType = {
    id?: true
    changeType?: true
    targetTable?: true
    targetId?: true
    agentId?: true
    fieldId?: true
    before?: true
    after?: true
    actorId?: true
    actorRole?: true
    reason?: true
    createdAt?: true
  }

  export type Node_config_changesMaxAggregateInputType = {
    id?: true
    changeType?: true
    targetTable?: true
    targetId?: true
    agentId?: true
    fieldId?: true
    before?: true
    after?: true
    actorId?: true
    actorRole?: true
    reason?: true
    createdAt?: true
  }

  export type Node_config_changesCountAggregateInputType = {
    id?: true
    changeType?: true
    targetTable?: true
    targetId?: true
    agentId?: true
    fieldId?: true
    before?: true
    after?: true
    actorId?: true
    actorRole?: true
    reason?: true
    createdAt?: true
    _all?: true
  }

  export type Node_config_changesAggregateArgs<ExtArgs extends $Extensions.InternalArgs = $Extensions.DefaultArgs> = {
    /**
     * Filter which node_config_changes to aggregate.
     */
    where?: node_config_changesWhereInput
    /**
     * {@link https://www.prisma.io/docs/concepts/components/prisma-client/sorting Sorting Docs}
     * 
     * Determine the order of node_config_changes to fetch.
     */
    orderBy?: node_config_changesOrderByWithRelationInput | node_config_changesOrderByWithRelationInput[]
    /**
     * {@link https://www.prisma.io/docs/concepts/components/prisma-client/pagination#cursor-based-pagination Cursor Docs}
     * 
     * Sets the start position
     */
    cursor?: node_config_changesWhereUniqueInput
    /**
     * {@link https://www.prisma.io/docs/concepts/components/prisma-client/pagination Pagination Docs}
     * 
     * Take `±n` node_config_changes from the position of the cursor.
     */
    take?: number
    /**
     * {@link https://www.prisma.io/docs/concepts/components/prisma-client/pagination Pagination Docs}
     * 
     * Skip the first `n` node_config_changes.
     */
    skip?: number
    /**
     * {@link https://www.prisma.io/docs/concepts/components/prisma-client/aggregations Aggregation Docs}
     * 
     * Count returned node_config_changes
    **/
    _count?: true | Node_config_changesCountAggregateInputType
    /**
     * {@link https://www.prisma.io/docs/concepts/components/prisma-client/aggregations Aggregation Docs}
     * 
     * Select which fields to find the minimum value
    **/
    _min?: Node_config_changesMinAggregateInputType
    /**
     * {@link https://www.prisma.io/docs/concepts/components/prisma-client/aggregations Aggregation Docs}
     * 
     * Select which fields to find the maximum value
    **/
    _max?: Node_config_changesMaxAggregateInputType
  }

  export type GetNode_config_changesAggregateType<T extends Node_config_changesAggregateArgs> = {
        [P in keyof T & keyof AggregateNode_config_changes]: P extends '_count' | 'count'
      ? T[P] extends true
        ? number
        : GetScalarType<T[P], AggregateNode_config_changes[P]>
      : GetScalarType<T[P], AggregateNode_config_changes[P]>
  }




  export type node_config_changesGroupByArgs<ExtArgs extends $Extensions.InternalArgs = $Extensions.DefaultArgs> = {
    where?: node_config_changesWhereInput
    orderBy?: node_config_changesOrderByWithAggregationInput | node_config_changesOrderByWithAggregationInput[]
    by: Node_config_changesScalarFieldEnum[] | Node_config_changesScalarFieldEnum
    having?: node_config_changesScalarWhereWithAggregatesInput
    take?: number
    skip?: number
    _count?: Node_config_changesCountAggregateInputType | true
    _min?: Node_config_changesMinAggregateInputType
    _max?: Node_config_changesMaxAggregateInputType
  }

  export type Node_config_changesGroupByOutputType = {
    id: string
    changeType: string
    targetTable: string
    targetId: string
    agentId: string | null
    fieldId: string | null
    before: string | null
    after: string | null
    actorId: string | null
    actorRole: string | null
    reason: string | null
    createdAt: Date
    _count: Node_config_changesCountAggregateOutputType | null
    _min: Node_config_changesMinAggregateOutputType | null
    _max: Node_config_changesMaxAggregateOutputType | null
  }

  type GetNode_config_changesGroupByPayload<T extends node_config_changesGroupByArgs> = Prisma.PrismaPromise<
    Array<
      PickEnumerable<Node_config_changesGroupByOutputType, T['by']> &
        {
          [P in ((keyof T) & (keyof Node_config_changesGroupByOutputType))]: P extends '_count'
            ? T[P] extends boolean
              ? number
              : GetScalarType<T[P], Node_config_changesGroupByOutputType[P]>
            : GetScalarType<T[P], Node_config_changesGroupByOutputType[P]>
        }
      >
    >


  export type node_config_changesSelect<ExtArgs extends $Extensions.InternalArgs = $Extensions.DefaultArgs> = $Extensions.GetSelect<{
    id?: boolean
    changeType?: boolean
    targetTable?: boolean
    targetId?: boolean
    agentId?: boolean
    fieldId?: boolean
    before?: boolean
    after?: boolean
    actorId?: boolean
    actorRole?: boolean
    reason?: boolean
    createdAt?: boolean
  }, ExtArgs["result"]["node_config_changes"]>

  export type node_config_changesSelectCreateManyAndReturn<ExtArgs extends $Extensions.InternalArgs = $Extensions.DefaultArgs> = $Extensions.GetSelect<{
    id?: boolean
    changeType?: boolean
    targetTable?: boolean
    targetId?: boolean
    agentId?: boolean
    fieldId?: boolean
    before?: boolean
    after?: boolean
    actorId?: boolean
    actorRole?: boolean
    reason?: boolean
    createdAt?: boolean
  }, ExtArgs["result"]["node_config_changes"]>

  export type node_config_changesSelectScalar = {
    id?: boolean
    changeType?: boolean
    targetTable?: boolean
    targetId?: boolean
    agentId?: boolean
    fieldId?: boolean
    before?: boolean
    after?: boolean
    actorId?: boolean
    actorRole?: boolean
    reason?: boolean
    createdAt?: boolean
  }


  export type $node_config_changesPayload<ExtArgs extends $Extensions.InternalArgs = $Extensions.DefaultArgs> = {
    name: "node_config_changes"
    objects: {}
    scalars: $Extensions.GetPayloadResult<{
      id: string
      changeType: string
      targetTable: string
      targetId: string
      agentId: string | null
      fieldId: string | null
      before: string | null
      after: string | null
      actorId: string | null
      actorRole: string | null
      reason: string | null
      createdAt: Date
    }, ExtArgs["result"]["node_config_changes"]>
    composites: {}
  }

  type node_config_changesGetPayload<S extends boolean | null | undefined | node_config_changesDefaultArgs> = $Result.GetResult<Prisma.$node_config_changesPayload, S>

  type node_config_changesCountArgs<ExtArgs extends $Extensions.InternalArgs = $Extensions.DefaultArgs> = 
    Omit<node_config_changesFindManyArgs, 'select' | 'include' | 'distinct'> & {
      select?: Node_config_changesCountAggregateInputType | true
    }

  export interface node_config_changesDelegate<ExtArgs extends $Extensions.InternalArgs = $Extensions.DefaultArgs> {
    [K: symbol]: { types: Prisma.TypeMap<ExtArgs>['model']['node_config_changes'], meta: { name: 'node_config_changes' } }
    /**
     * Find zero or one Node_config_changes that matches the filter.
     * @param {node_config_changesFindUniqueArgs} args - Arguments to find a Node_config_changes
     * @example
     * // Get one Node_config_changes
     * const node_config_changes = await prisma.node_config_changes.findUnique({
     *   where: {
     *     // ... provide filter here
     *   }
     * })
     */
    findUnique<T extends node_config_changesFindUniqueArgs>(args: SelectSubset<T, node_config_changesFindUniqueArgs<ExtArgs>>): Prisma__node_config_changesClient<$Result.GetResult<Prisma.$node_config_changesPayload<ExtArgs>, T, "findUnique"> | null, null, ExtArgs>

    /**
     * Find one Node_config_changes that matches the filter or throw an error with `error.code='P2025'` 
     * if no matches were found.
     * @param {node_config_changesFindUniqueOrThrowArgs} args - Arguments to find a Node_config_changes
     * @example
     * // Get one Node_config_changes
     * const node_config_changes = await prisma.node_config_changes.findUniqueOrThrow({
     *   where: {
     *     // ... provide filter here
     *   }
     * })
     */
    findUniqueOrThrow<T extends node_config_changesFindUniqueOrThrowArgs>(args: SelectSubset<T, node_config_changesFindUniqueOrThrowArgs<ExtArgs>>): Prisma__node_config_changesClient<$Result.GetResult<Prisma.$node_config_changesPayload<ExtArgs>, T, "findUniqueOrThrow">, never, ExtArgs>

    /**
     * Find the first Node_config_changes that matches the filter.
     * Note, that providing `undefined` is treated as the value not being there.
     * Read more here: https://pris.ly/d/null-undefined
     * @param {node_config_changesFindFirstArgs} args - Arguments to find a Node_config_changes
     * @example
     * // Get one Node_config_changes
     * const node_config_changes = await prisma.node_config_changes.findFirst({
     *   where: {
     *     // ... provide filter here
     *   }
     * })
     */
    findFirst<T extends node_config_changesFindFirstArgs>(args?: SelectSubset<T, node_config_changesFindFirstArgs<ExtArgs>>): Prisma__node_config_changesClient<$Result.GetResult<Prisma.$node_config_changesPayload<ExtArgs>, T, "findFirst"> | null, null, ExtArgs>

    /**
     * Find the first Node_config_changes that matches the filter or
     * throw `PrismaKnownClientError` with `P2025` code if no matches were found.
     * Note, that providing `undefined` is treated as the value not being there.
     * Read more here: https://pris.ly/d/null-undefined
     * @param {node_config_changesFindFirstOrThrowArgs} args - Arguments to find a Node_config_changes
     * @example
     * // Get one Node_config_changes
     * const node_config_changes = await prisma.node_config_changes.findFirstOrThrow({
     *   where: {
     *     // ... provide filter here
     *   }
     * })
     */
    findFirstOrThrow<T extends node_config_changesFindFirstOrThrowArgs>(args?: SelectSubset<T, node_config_changesFindFirstOrThrowArgs<ExtArgs>>): Prisma__node_config_changesClient<$Result.GetResult<Prisma.$node_config_changesPayload<ExtArgs>, T, "findFirstOrThrow">, never, ExtArgs>

    /**
     * Find zero or more Node_config_changes that matches the filter.
     * Note, that providing `undefined` is treated as the value not being there.
     * Read more here: https://pris.ly/d/null-undefined
     * @param {node_config_changesFindManyArgs} args - Arguments to filter and select certain fields only.
     * @example
     * // Get all Node_config_changes
     * const node_config_changes = await prisma.node_config_changes.findMany()
     * 
     * // Get first 10 Node_config_changes
     * const node_config_changes = await prisma.node_config_changes.findMany({ take: 10 })
     * 
     * // Only select the `id`
     * const node_config_changesWithIdOnly = await prisma.node_config_changes.findMany({ select: { id: true } })
     * 
     */
    findMany<T extends node_config_changesFindManyArgs>(args?: SelectSubset<T, node_config_changesFindManyArgs<ExtArgs>>): Prisma.PrismaPromise<$Result.GetResult<Prisma.$node_config_changesPayload<ExtArgs>, T, "findMany">>

    /**
     * Create a Node_config_changes.
     * @param {node_config_changesCreateArgs} args - Arguments to create a Node_config_changes.
     * @example
     * // Create one Node_config_changes
     * const Node_config_changes = await prisma.node_config_changes.create({
     *   data: {
     *     // ... data to create a Node_config_changes
     *   }
     * })
     * 
     */
    create<T extends node_config_changesCreateArgs>(args: SelectSubset<T, node_config_changesCreateArgs<ExtArgs>>): Prisma__node_config_changesClient<$Result.GetResult<Prisma.$node_config_changesPayload<ExtArgs>, T, "create">, never, ExtArgs>

    /**
     * Create many Node_config_changes.
     * @param {node_config_changesCreateManyArgs} args - Arguments to create many Node_config_changes.
     * @example
     * // Create many Node_config_changes
     * const node_config_changes = await prisma.node_config_changes.createMany({
     *   data: [
     *     // ... provide data here
     *   ]
     * })
     *     
     */
    createMany<T extends node_config_changesCreateManyArgs>(args?: SelectSubset<T, node_config_changesCreateManyArgs<ExtArgs>>): Prisma.PrismaPromise<BatchPayload>

    /**
     * Create many Node_config_changes and returns the data saved in the database.
     * @param {node_config_changesCreateManyAndReturnArgs} args - Arguments to create many Node_config_changes.
     * @example
     * // Create many Node_config_changes
     * const node_config_changes = await prisma.node_config_changes.createManyAndReturn({
     *   data: [
     *     // ... provide data here
     *   ]
     * })
     * 
     * // Create many Node_config_changes and only return the `id`
     * const node_config_changesWithIdOnly = await prisma.node_config_changes.createManyAndReturn({ 
     *   select: { id: true },
     *   data: [
     *     // ... provide data here
     *   ]
     * })
     * Note, that providing `undefined` is treated as the value not being there.
     * Read more here: https://pris.ly/d/null-undefined
     * 
     */
    createManyAndReturn<T extends node_config_changesCreateManyAndReturnArgs>(args?: SelectSubset<T, node_config_changesCreateManyAndReturnArgs<ExtArgs>>): Prisma.PrismaPromise<$Result.GetResult<Prisma.$node_config_changesPayload<ExtArgs>, T, "createManyAndReturn">>

    /**
     * Delete a Node_config_changes.
     * @param {node_config_changesDeleteArgs} args - Arguments to delete one Node_config_changes.
     * @example
     * // Delete one Node_config_changes
     * const Node_config_changes = await prisma.node_config_changes.delete({
     *   where: {
     *     // ... filter to delete one Node_config_changes
     *   }
     * })
     * 
     */
    delete<T extends node_config_changesDeleteArgs>(args: SelectSubset<T, node_config_changesDeleteArgs<ExtArgs>>): Prisma__node_config_changesClient<$Result.GetResult<Prisma.$node_config_changesPayload<ExtArgs>, T, "delete">, never, ExtArgs>

    /**
     * Update one Node_config_changes.
     * @param {node_config_changesUpdateArgs} args - Arguments to update one Node_config_changes.
     * @example
     * // Update one Node_config_changes
     * const node_config_changes = await prisma.node_config_changes.update({
     *   where: {
     *     // ... provide filter here
     *   },
     *   data: {
     *     // ... provide data here
     *   }
     * })
     * 
     */
    update<T extends node_config_changesUpdateArgs>(args: SelectSubset<T, node_config_changesUpdateArgs<ExtArgs>>): Prisma__node_config_changesClient<$Result.GetResult<Prisma.$node_config_changesPayload<ExtArgs>, T, "update">, never, ExtArgs>

    /**
     * Delete zero or more Node_config_changes.
     * @param {node_config_changesDeleteManyArgs} args - Arguments to filter Node_config_changes to delete.
     * @example
     * // Delete a few Node_config_changes
     * const { count } = await prisma.node_config_changes.deleteMany({
     *   where: {
     *     // ... provide filter here
     *   }
     * })
     * 
     */
    deleteMany<T extends node_config_changesDeleteManyArgs>(args?: SelectSubset<T, node_config_changesDeleteManyArgs<ExtArgs>>): Prisma.PrismaPromise<BatchPayload>

    /**
     * Update zero or more Node_config_changes.
     * Note, that providing `undefined` is treated as the value not being there.
     * Read more here: https://pris.ly/d/null-undefined
     * @param {node_config_changesUpdateManyArgs} args - Arguments to update one or more rows.
     * @example
     * // Update many Node_config_changes
     * const node_config_changes = await prisma.node_config_changes.updateMany({
     *   where: {
     *     // ... provide filter here
     *   },
     *   data: {
     *     // ... provide data here
     *   }
     * })
     * 
     */
    updateMany<T extends node_config_changesUpdateManyArgs>(args: SelectSubset<T, node_config_changesUpdateManyArgs<ExtArgs>>): Prisma.PrismaPromise<BatchPayload>

    /**
     * Create or update one Node_config_changes.
     * @param {node_config_changesUpsertArgs} args - Arguments to update or create a Node_config_changes.
     * @example
     * // Update or create a Node_config_changes
     * const node_config_changes = await prisma.node_config_changes.upsert({
     *   create: {
     *     // ... data to create a Node_config_changes
     *   },
     *   update: {
     *     // ... in case it already exists, update
     *   },
     *   where: {
     *     // ... the filter for the Node_config_changes we want to update
     *   }
     * })
     */
    upsert<T extends node_config_changesUpsertArgs>(args: SelectSubset<T, node_config_changesUpsertArgs<ExtArgs>>): Prisma__node_config_changesClient<$Result.GetResult<Prisma.$node_config_changesPayload<ExtArgs>, T, "upsert">, never, ExtArgs>


    /**
     * Count the number of Node_config_changes.
     * Note, that providing `undefined` is treated as the value not being there.
     * Read more here: https://pris.ly/d/null-undefined
     * @param {node_config_changesCountArgs} args - Arguments to filter Node_config_changes to count.
     * @example
     * // Count the number of Node_config_changes
     * const count = await prisma.node_config_changes.count({
     *   where: {
     *     // ... the filter for the Node_config_changes we want to count
     *   }
     * })
    **/
    count<T extends node_config_changesCountArgs>(
      args?: Subset<T, node_config_changesCountArgs>,
    ): Prisma.PrismaPromise<
      T extends $Utils.Record<'select', any>
        ? T['select'] extends true
          ? number
          : GetScalarType<T['select'], Node_config_changesCountAggregateOutputType>
        : number
    >

    /**
     * Allows you to perform aggregations operations on a Node_config_changes.
     * Note, that providing `undefined` is treated as the value not being there.
     * Read more here: https://pris.ly/d/null-undefined
     * @param {Node_config_changesAggregateArgs} args - Select which aggregations you would like to apply and on what fields.
     * @example
     * // Ordered by age ascending
     * // Where email contains prisma.io
     * // Limited to the 10 users
     * const aggregations = await prisma.user.aggregate({
     *   _avg: {
     *     age: true,
     *   },
     *   where: {
     *     email: {
     *       contains: "prisma.io",
     *     },
     *   },
     *   orderBy: {
     *     age: "asc",
     *   },
     *   take: 10,
     * })
    **/
    aggregate<T extends Node_config_changesAggregateArgs>(args: Subset<T, Node_config_changesAggregateArgs>): Prisma.PrismaPromise<GetNode_config_changesAggregateType<T>>

    /**
     * Group by Node_config_changes.
     * Note, that providing `undefined` is treated as the value not being there.
     * Read more here: https://pris.ly/d/null-undefined
     * @param {node_config_changesGroupByArgs} args - Group by arguments.
     * @example
     * // Group by city, order by createdAt, get count
     * const result = await prisma.user.groupBy({
     *   by: ['city', 'createdAt'],
     *   orderBy: {
     *     createdAt: true
     *   },
     *   _count: {
     *     _all: true
     *   },
     * })
     * 
    **/
    groupBy<
      T extends node_config_changesGroupByArgs,
      HasSelectOrTake extends Or<
        Extends<'skip', Keys<T>>,
        Extends<'take', Keys<T>>
      >,
      OrderByArg extends True extends HasSelectOrTake
        ? { orderBy: node_config_changesGroupByArgs['orderBy'] }
        : { orderBy?: node_config_changesGroupByArgs['orderBy'] },
      OrderFields extends ExcludeUnderscoreKeys<Keys<MaybeTupleToUnion<T['orderBy']>>>,
      ByFields extends MaybeTupleToUnion<T['by']>,
      ByValid extends Has<ByFields, OrderFields>,
      HavingFields extends GetHavingFields<T['having']>,
      HavingValid extends Has<ByFields, HavingFields>,
      ByEmpty extends T['by'] extends never[] ? True : False,
      InputErrors extends ByEmpty extends True
      ? `Error: "by" must not be empty.`
      : HavingValid extends False
      ? {
          [P in HavingFields]: P extends ByFields
            ? never
            : P extends string
            ? `Error: Field "${P}" used in "having" needs to be provided in "by".`
            : [
                Error,
                'Field ',
                P,
                ` in "having" needs to be provided in "by"`,
              ]
        }[HavingFields]
      : 'take' extends Keys<T>
      ? 'orderBy' extends Keys<T>
        ? ByValid extends True
          ? {}
          : {
              [P in OrderFields]: P extends ByFields
                ? never
                : `Error: Field "${P}" in "orderBy" needs to be provided in "by"`
            }[OrderFields]
        : 'Error: If you provide "take", you also need to provide "orderBy"'
      : 'skip' extends Keys<T>
      ? 'orderBy' extends Keys<T>
        ? ByValid extends True
          ? {}
          : {
              [P in OrderFields]: P extends ByFields
                ? never
                : `Error: Field "${P}" in "orderBy" needs to be provided in "by"`
            }[OrderFields]
        : 'Error: If you provide "skip", you also need to provide "orderBy"'
      : ByValid extends True
      ? {}
      : {
          [P in OrderFields]: P extends ByFields
            ? never
            : `Error: Field "${P}" in "orderBy" needs to be provided in "by"`
        }[OrderFields]
    >(args: SubsetIntersection<T, node_config_changesGroupByArgs, OrderByArg> & InputErrors): {} extends InputErrors ? GetNode_config_changesGroupByPayload<T> : Prisma.PrismaPromise<InputErrors>
  /**
   * Fields of the node_config_changes model
   */
  readonly fields: node_config_changesFieldRefs;
  }

  /**
   * The delegate class that acts as a "Promise-like" for node_config_changes.
   * Why is this prefixed with `Prisma__`?
   * Because we want to prevent naming conflicts as mentioned in
   * https://github.com/prisma/prisma-client-js/issues/707
   */
  export interface Prisma__node_config_changesClient<T, Null = never, ExtArgs extends $Extensions.InternalArgs = $Extensions.DefaultArgs> extends Prisma.PrismaPromise<T> {
    readonly [Symbol.toStringTag]: "PrismaPromise"
    /**
     * Attaches callbacks for the resolution and/or rejection of the Promise.
     * @param onfulfilled The callback to execute when the Promise is resolved.
     * @param onrejected The callback to execute when the Promise is rejected.
     * @returns A Promise for the completion of which ever callback is executed.
     */
    then<TResult1 = T, TResult2 = never>(onfulfilled?: ((value: T) => TResult1 | PromiseLike<TResult1>) | undefined | null, onrejected?: ((reason: any) => TResult2 | PromiseLike<TResult2>) | undefined | null): $Utils.JsPromise<TResult1 | TResult2>
    /**
     * Attaches a callback for only the rejection of the Promise.
     * @param onrejected The callback to execute when the Promise is rejected.
     * @returns A Promise for the completion of the callback.
     */
    catch<TResult = never>(onrejected?: ((reason: any) => TResult | PromiseLike<TResult>) | undefined | null): $Utils.JsPromise<T | TResult>
    /**
     * Attaches a callback that is invoked when the Promise is settled (fulfilled or rejected). The
     * resolved value cannot be modified from the callback.
     * @param onfinally The callback to execute when the Promise is settled (fulfilled or rejected).
     * @returns A Promise for the completion of the callback.
     */
    finally(onfinally?: (() => void) | undefined | null): $Utils.JsPromise<T>
  }




  /**
   * Fields of the node_config_changes model
   */ 
  interface node_config_changesFieldRefs {
    readonly id: FieldRef<"node_config_changes", 'String'>
    readonly changeType: FieldRef<"node_config_changes", 'String'>
    readonly targetTable: FieldRef<"node_config_changes", 'String'>
    readonly targetId: FieldRef<"node_config_changes", 'String'>
    readonly agentId: FieldRef<"node_config_changes", 'String'>
    readonly fieldId: FieldRef<"node_config_changes", 'String'>
    readonly before: FieldRef<"node_config_changes", 'String'>
    readonly after: FieldRef<"node_config_changes", 'String'>
    readonly actorId: FieldRef<"node_config_changes", 'String'>
    readonly actorRole: FieldRef<"node_config_changes", 'String'>
    readonly reason: FieldRef<"node_config_changes", 'String'>
    readonly createdAt: FieldRef<"node_config_changes", 'DateTime'>
  }
    

  // Custom InputTypes
  /**
   * node_config_changes findUnique
   */
  export type node_config_changesFindUniqueArgs<ExtArgs extends $Extensions.InternalArgs = $Extensions.DefaultArgs> = {
    /**
     * Select specific fields to fetch from the node_config_changes
     */
    select?: node_config_changesSelect<ExtArgs> | null
    /**
     * Filter, which node_config_changes to fetch.
     */
    where: node_config_changesWhereUniqueInput
  }

  /**
   * node_config_changes findUniqueOrThrow
   */
  export type node_config_changesFindUniqueOrThrowArgs<ExtArgs extends $Extensions.InternalArgs = $Extensions.DefaultArgs> = {
    /**
     * Select specific fields to fetch from the node_config_changes
     */
    select?: node_config_changesSelect<ExtArgs> | null
    /**
     * Filter, which node_config_changes to fetch.
     */
    where: node_config_changesWhereUniqueInput
  }

  /**
   * node_config_changes findFirst
   */
  export type node_config_changesFindFirstArgs<ExtArgs extends $Extensions.InternalArgs = $Extensions.DefaultArgs> = {
    /**
     * Select specific fields to fetch from the node_config_changes
     */
    select?: node_config_changesSelect<ExtArgs> | null
    /**
     * Filter, which node_config_changes to fetch.
     */
    where?: node_config_changesWhereInput
    /**
     * {@link https://www.prisma.io/docs/concepts/components/prisma-client/sorting Sorting Docs}
     * 
     * Determine the order of node_config_changes to fetch.
     */
    orderBy?: node_config_changesOrderByWithRelationInput | node_config_changesOrderByWithRelationInput[]
    /**
     * {@link https://www.prisma.io/docs/concepts/components/prisma-client/pagination#cursor-based-pagination Cursor Docs}
     * 
     * Sets the position for searching for node_config_changes.
     */
    cursor?: node_config_changesWhereUniqueInput
    /**
     * {@link https://www.prisma.io/docs/concepts/components/prisma-client/pagination Pagination Docs}
     * 
     * Take `±n` node_config_changes from the position of the cursor.
     */
    take?: number
    /**
     * {@link https://www.prisma.io/docs/concepts/components/prisma-client/pagination Pagination Docs}
     * 
     * Skip the first `n` node_config_changes.
     */
    skip?: number
    /**
     * {@link https://www.prisma.io/docs/concepts/components/prisma-client/distinct Distinct Docs}
     * 
     * Filter by unique combinations of node_config_changes.
     */
    distinct?: Node_config_changesScalarFieldEnum | Node_config_changesScalarFieldEnum[]
  }

  /**
   * node_config_changes findFirstOrThrow
   */
  export type node_config_changesFindFirstOrThrowArgs<ExtArgs extends $Extensions.InternalArgs = $Extensions.DefaultArgs> = {
    /**
     * Select specific fields to fetch from the node_config_changes
     */
    select?: node_config_changesSelect<ExtArgs> | null
    /**
     * Filter, which node_config_changes to fetch.
     */
    where?: node_config_changesWhereInput
    /**
     * {@link https://www.prisma.io/docs/concepts/components/prisma-client/sorting Sorting Docs}
     * 
     * Determine the order of node_config_changes to fetch.
     */
    orderBy?: node_config_changesOrderByWithRelationInput | node_config_changesOrderByWithRelationInput[]
    /**
     * {@link https://www.prisma.io/docs/concepts/components/prisma-client/pagination#cursor-based-pagination Cursor Docs}
     * 
     * Sets the position for searching for node_config_changes.
     */
    cursor?: node_config_changesWhereUniqueInput
    /**
     * {@link https://www.prisma.io/docs/concepts/components/prisma-client/pagination Pagination Docs}
     * 
     * Take `±n` node_config_changes from the position of the cursor.
     */
    take?: number
    /**
     * {@link https://www.prisma.io/docs/concepts/components/prisma-client/pagination Pagination Docs}
     * 
     * Skip the first `n` node_config_changes.
     */
    skip?: number
    /**
     * {@link https://www.prisma.io/docs/concepts/components/prisma-client/distinct Distinct Docs}
     * 
     * Filter by unique combinations of node_config_changes.
     */
    distinct?: Node_config_changesScalarFieldEnum | Node_config_changesScalarFieldEnum[]
  }

  /**
   * node_config_changes findMany
   */
  export type node_config_changesFindManyArgs<ExtArgs extends $Extensions.InternalArgs = $Extensions.DefaultArgs> = {
    /**
     * Select specific fields to fetch from the node_config_changes
     */
    select?: node_config_changesSelect<ExtArgs> | null
    /**
     * Filter, which node_config_changes to fetch.
     */
    where?: node_config_changesWhereInput
    /**
     * {@link https://www.prisma.io/docs/concepts/components/prisma-client/sorting Sorting Docs}
     * 
     * Determine the order of node_config_changes to fetch.
     */
    orderBy?: node_config_changesOrderByWithRelationInput | node_config_changesOrderByWithRelationInput[]
    /**
     * {@link https://www.prisma.io/docs/concepts/components/prisma-client/pagination#cursor-based-pagination Cursor Docs}
     * 
     * Sets the position for listing node_config_changes.
     */
    cursor?: node_config_changesWhereUniqueInput
    /**
     * {@link https://www.prisma.io/docs/concepts/components/prisma-client/pagination Pagination Docs}
     * 
     * Take `±n` node_config_changes from the position of the cursor.
     */
    take?: number
    /**
     * {@link https://www.prisma.io/docs/concepts/components/prisma-client/pagination Pagination Docs}
     * 
     * Skip the first `n` node_config_changes.
     */
    skip?: number
    distinct?: Node_config_changesScalarFieldEnum | Node_config_changesScalarFieldEnum[]
  }

  /**
   * node_config_changes create
   */
  export type node_config_changesCreateArgs<ExtArgs extends $Extensions.InternalArgs = $Extensions.DefaultArgs> = {
    /**
     * Select specific fields to fetch from the node_config_changes
     */
    select?: node_config_changesSelect<ExtArgs> | null
    /**
     * The data needed to create a node_config_changes.
     */
    data: XOR<node_config_changesCreateInput, node_config_changesUncheckedCreateInput>
  }

  /**
   * node_config_changes createMany
   */
  export type node_config_changesCreateManyArgs<ExtArgs extends $Extensions.InternalArgs = $Extensions.DefaultArgs> = {
    /**
     * The data used to create many node_config_changes.
     */
    data: node_config_changesCreateManyInput | node_config_changesCreateManyInput[]
  }

  /**
   * node_config_changes createManyAndReturn
   */
  export type node_config_changesCreateManyAndReturnArgs<ExtArgs extends $Extensions.InternalArgs = $Extensions.DefaultArgs> = {
    /**
     * Select specific fields to fetch from the node_config_changes
     */
    select?: node_config_changesSelectCreateManyAndReturn<ExtArgs> | null
    /**
     * The data used to create many node_config_changes.
     */
    data: node_config_changesCreateManyInput | node_config_changesCreateManyInput[]
  }

  /**
   * node_config_changes update
   */
  export type node_config_changesUpdateArgs<ExtArgs extends $Extensions.InternalArgs = $Extensions.DefaultArgs> = {
    /**
     * Select specific fields to fetch from the node_config_changes
     */
    select?: node_config_changesSelect<ExtArgs> | null
    /**
     * The data needed to update a node_config_changes.
     */
    data: XOR<node_config_changesUpdateInput, node_config_changesUncheckedUpdateInput>
    /**
     * Choose, which node_config_changes to update.
     */
    where: node_config_changesWhereUniqueInput
  }

  /**
   * node_config_changes updateMany
   */
  export type node_config_changesUpdateManyArgs<ExtArgs extends $Extensions.InternalArgs = $Extensions.DefaultArgs> = {
    /**
     * The data used to update node_config_changes.
     */
    data: XOR<node_config_changesUpdateManyMutationInput, node_config_changesUncheckedUpdateManyInput>
    /**
     * Filter which node_config_changes to update
     */
    where?: node_config_changesWhereInput
  }

  /**
   * node_config_changes upsert
   */
  export type node_config_changesUpsertArgs<ExtArgs extends $Extensions.InternalArgs = $Extensions.DefaultArgs> = {
    /**
     * Select specific fields to fetch from the node_config_changes
     */
    select?: node_config_changesSelect<ExtArgs> | null
    /**
     * The filter to search for the node_config_changes to update in case it exists.
     */
    where: node_config_changesWhereUniqueInput
    /**
     * In case the node_config_changes found by the `where` argument doesn't exist, create a new node_config_changes with this data.
     */
    create: XOR<node_config_changesCreateInput, node_config_changesUncheckedCreateInput>
    /**
     * In case the node_config_changes was found with the provided `where` argument, update it with this data.
     */
    update: XOR<node_config_changesUpdateInput, node_config_changesUncheckedUpdateInput>
  }

  /**
   * node_config_changes delete
   */
  export type node_config_changesDeleteArgs<ExtArgs extends $Extensions.InternalArgs = $Extensions.DefaultArgs> = {
    /**
     * Select specific fields to fetch from the node_config_changes
     */
    select?: node_config_changesSelect<ExtArgs> | null
    /**
     * Filter which node_config_changes to delete.
     */
    where: node_config_changesWhereUniqueInput
  }

  /**
   * node_config_changes deleteMany
   */
  export type node_config_changesDeleteManyArgs<ExtArgs extends $Extensions.InternalArgs = $Extensions.DefaultArgs> = {
    /**
     * Filter which node_config_changes to delete
     */
    where?: node_config_changesWhereInput
  }

  /**
   * node_config_changes without action
   */
  export type node_config_changesDefaultArgs<ExtArgs extends $Extensions.InternalArgs = $Extensions.DefaultArgs> = {
    /**
     * Select specific fields to fetch from the node_config_changes
     */
    select?: node_config_changesSelect<ExtArgs> | null
  }


  /**
   * Model prompt_eval_cases
   */

  export type AggregatePrompt_eval_cases = {
    _count: Prompt_eval_casesCountAggregateOutputType | null
    _min: Prompt_eval_casesMinAggregateOutputType | null
    _max: Prompt_eval_casesMaxAggregateOutputType | null
  }

  export type Prompt_eval_casesMinAggregateOutputType = {
    id: string | null
    agentId: string | null
    caseId: string | null
    name: string | null
    description: string | null
    messagesJson: string | null
    previousStateJson: string | null
    expectationsJson: string | null
    enabled: boolean | null
    createdBy: string | null
    createdAt: Date | null
    updatedAt: Date | null
  }

  export type Prompt_eval_casesMaxAggregateOutputType = {
    id: string | null
    agentId: string | null
    caseId: string | null
    name: string | null
    description: string | null
    messagesJson: string | null
    previousStateJson: string | null
    expectationsJson: string | null
    enabled: boolean | null
    createdBy: string | null
    createdAt: Date | null
    updatedAt: Date | null
  }

  export type Prompt_eval_casesCountAggregateOutputType = {
    id: number
    agentId: number
    caseId: number
    name: number
    description: number
    messagesJson: number
    previousStateJson: number
    expectationsJson: number
    enabled: number
    createdBy: number
    createdAt: number
    updatedAt: number
    _all: number
  }


  export type Prompt_eval_casesMinAggregateInputType = {
    id?: true
    agentId?: true
    caseId?: true
    name?: true
    description?: true
    messagesJson?: true
    previousStateJson?: true
    expectationsJson?: true
    enabled?: true
    createdBy?: true
    createdAt?: true
    updatedAt?: true
  }

  export type Prompt_eval_casesMaxAggregateInputType = {
    id?: true
    agentId?: true
    caseId?: true
    name?: true
    description?: true
    messagesJson?: true
    previousStateJson?: true
    expectationsJson?: true
    enabled?: true
    createdBy?: true
    createdAt?: true
    updatedAt?: true
  }

  export type Prompt_eval_casesCountAggregateInputType = {
    id?: true
    agentId?: true
    caseId?: true
    name?: true
    description?: true
    messagesJson?: true
    previousStateJson?: true
    expectationsJson?: true
    enabled?: true
    createdBy?: true
    createdAt?: true
    updatedAt?: true
    _all?: true
  }

  export type Prompt_eval_casesAggregateArgs<ExtArgs extends $Extensions.InternalArgs = $Extensions.DefaultArgs> = {
    /**
     * Filter which prompt_eval_cases to aggregate.
     */
    where?: prompt_eval_casesWhereInput
    /**
     * {@link https://www.prisma.io/docs/concepts/components/prisma-client/sorting Sorting Docs}
     * 
     * Determine the order of prompt_eval_cases to fetch.
     */
    orderBy?: prompt_eval_casesOrderByWithRelationInput | prompt_eval_casesOrderByWithRelationInput[]
    /**
     * {@link https://www.prisma.io/docs/concepts/components/prisma-client/pagination#cursor-based-pagination Cursor Docs}
     * 
     * Sets the start position
     */
    cursor?: prompt_eval_casesWhereUniqueInput
    /**
     * {@link https://www.prisma.io/docs/concepts/components/prisma-client/pagination Pagination Docs}
     * 
     * Take `±n` prompt_eval_cases from the position of the cursor.
     */
    take?: number
    /**
     * {@link https://www.prisma.io/docs/concepts/components/prisma-client/pagination Pagination Docs}
     * 
     * Skip the first `n` prompt_eval_cases.
     */
    skip?: number
    /**
     * {@link https://www.prisma.io/docs/concepts/components/prisma-client/aggregations Aggregation Docs}
     * 
     * Count returned prompt_eval_cases
    **/
    _count?: true | Prompt_eval_casesCountAggregateInputType
    /**
     * {@link https://www.prisma.io/docs/concepts/components/prisma-client/aggregations Aggregation Docs}
     * 
     * Select which fields to find the minimum value
    **/
    _min?: Prompt_eval_casesMinAggregateInputType
    /**
     * {@link https://www.prisma.io/docs/concepts/components/prisma-client/aggregations Aggregation Docs}
     * 
     * Select which fields to find the maximum value
    **/
    _max?: Prompt_eval_casesMaxAggregateInputType
  }

  export type GetPrompt_eval_casesAggregateType<T extends Prompt_eval_casesAggregateArgs> = {
        [P in keyof T & keyof AggregatePrompt_eval_cases]: P extends '_count' | 'count'
      ? T[P] extends true
        ? number
        : GetScalarType<T[P], AggregatePrompt_eval_cases[P]>
      : GetScalarType<T[P], AggregatePrompt_eval_cases[P]>
  }




  export type prompt_eval_casesGroupByArgs<ExtArgs extends $Extensions.InternalArgs = $Extensions.DefaultArgs> = {
    where?: prompt_eval_casesWhereInput
    orderBy?: prompt_eval_casesOrderByWithAggregationInput | prompt_eval_casesOrderByWithAggregationInput[]
    by: Prompt_eval_casesScalarFieldEnum[] | Prompt_eval_casesScalarFieldEnum
    having?: prompt_eval_casesScalarWhereWithAggregatesInput
    take?: number
    skip?: number
    _count?: Prompt_eval_casesCountAggregateInputType | true
    _min?: Prompt_eval_casesMinAggregateInputType
    _max?: Prompt_eval_casesMaxAggregateInputType
  }

  export type Prompt_eval_casesGroupByOutputType = {
    id: string
    agentId: string
    caseId: string
    name: string
    description: string | null
    messagesJson: string
    previousStateJson: string | null
    expectationsJson: string | null
    enabled: boolean
    createdBy: string | null
    createdAt: Date
    updatedAt: Date
    _count: Prompt_eval_casesCountAggregateOutputType | null
    _min: Prompt_eval_casesMinAggregateOutputType | null
    _max: Prompt_eval_casesMaxAggregateOutputType | null
  }

  type GetPrompt_eval_casesGroupByPayload<T extends prompt_eval_casesGroupByArgs> = Prisma.PrismaPromise<
    Array<
      PickEnumerable<Prompt_eval_casesGroupByOutputType, T['by']> &
        {
          [P in ((keyof T) & (keyof Prompt_eval_casesGroupByOutputType))]: P extends '_count'
            ? T[P] extends boolean
              ? number
              : GetScalarType<T[P], Prompt_eval_casesGroupByOutputType[P]>
            : GetScalarType<T[P], Prompt_eval_casesGroupByOutputType[P]>
        }
      >
    >


  export type prompt_eval_casesSelect<ExtArgs extends $Extensions.InternalArgs = $Extensions.DefaultArgs> = $Extensions.GetSelect<{
    id?: boolean
    agentId?: boolean
    caseId?: boolean
    name?: boolean
    description?: boolean
    messagesJson?: boolean
    previousStateJson?: boolean
    expectationsJson?: boolean
    enabled?: boolean
    createdBy?: boolean
    createdAt?: boolean
    updatedAt?: boolean
  }, ExtArgs["result"]["prompt_eval_cases"]>

  export type prompt_eval_casesSelectCreateManyAndReturn<ExtArgs extends $Extensions.InternalArgs = $Extensions.DefaultArgs> = $Extensions.GetSelect<{
    id?: boolean
    agentId?: boolean
    caseId?: boolean
    name?: boolean
    description?: boolean
    messagesJson?: boolean
    previousStateJson?: boolean
    expectationsJson?: boolean
    enabled?: boolean
    createdBy?: boolean
    createdAt?: boolean
    updatedAt?: boolean
  }, ExtArgs["result"]["prompt_eval_cases"]>

  export type prompt_eval_casesSelectScalar = {
    id?: boolean
    agentId?: boolean
    caseId?: boolean
    name?: boolean
    description?: boolean
    messagesJson?: boolean
    previousStateJson?: boolean
    expectationsJson?: boolean
    enabled?: boolean
    createdBy?: boolean
    createdAt?: boolean
    updatedAt?: boolean
  }


  export type $prompt_eval_casesPayload<ExtArgs extends $Extensions.InternalArgs = $Extensions.DefaultArgs> = {
    name: "prompt_eval_cases"
    objects: {}
    scalars: $Extensions.GetPayloadResult<{
      id: string
      agentId: string
      caseId: string
      name: string
      description: string | null
      messagesJson: string
      previousStateJson: string | null
      expectationsJson: string | null
      enabled: boolean
      createdBy: string | null
      createdAt: Date
      updatedAt: Date
    }, ExtArgs["result"]["prompt_eval_cases"]>
    composites: {}
  }

  type prompt_eval_casesGetPayload<S extends boolean | null | undefined | prompt_eval_casesDefaultArgs> = $Result.GetResult<Prisma.$prompt_eval_casesPayload, S>

  type prompt_eval_casesCountArgs<ExtArgs extends $Extensions.InternalArgs = $Extensions.DefaultArgs> = 
    Omit<prompt_eval_casesFindManyArgs, 'select' | 'include' | 'distinct'> & {
      select?: Prompt_eval_casesCountAggregateInputType | true
    }

  export interface prompt_eval_casesDelegate<ExtArgs extends $Extensions.InternalArgs = $Extensions.DefaultArgs> {
    [K: symbol]: { types: Prisma.TypeMap<ExtArgs>['model']['prompt_eval_cases'], meta: { name: 'prompt_eval_cases' } }
    /**
     * Find zero or one Prompt_eval_cases that matches the filter.
     * @param {prompt_eval_casesFindUniqueArgs} args - Arguments to find a Prompt_eval_cases
     * @example
     * // Get one Prompt_eval_cases
     * const prompt_eval_cases = await prisma.prompt_eval_cases.findUnique({
     *   where: {
     *     // ... provide filter here
     *   }
     * })
     */
    findUnique<T extends prompt_eval_casesFindUniqueArgs>(args: SelectSubset<T, prompt_eval_casesFindUniqueArgs<ExtArgs>>): Prisma__prompt_eval_casesClient<$Result.GetResult<Prisma.$prompt_eval_casesPayload<ExtArgs>, T, "findUnique"> | null, null, ExtArgs>

    /**
     * Find one Prompt_eval_cases that matches the filter or throw an error with `error.code='P2025'` 
     * if no matches were found.
     * @param {prompt_eval_casesFindUniqueOrThrowArgs} args - Arguments to find a Prompt_eval_cases
     * @example
     * // Get one Prompt_eval_cases
     * const prompt_eval_cases = await prisma.prompt_eval_cases.findUniqueOrThrow({
     *   where: {
     *     // ... provide filter here
     *   }
     * })
     */
    findUniqueOrThrow<T extends prompt_eval_casesFindUniqueOrThrowArgs>(args: SelectSubset<T, prompt_eval_casesFindUniqueOrThrowArgs<ExtArgs>>): Prisma__prompt_eval_casesClient<$Result.GetResult<Prisma.$prompt_eval_casesPayload<ExtArgs>, T, "findUniqueOrThrow">, never, ExtArgs>

    /**
     * Find the first Prompt_eval_cases that matches the filter.
     * Note, that providing `undefined` is treated as the value not being there.
     * Read more here: https://pris.ly/d/null-undefined
     * @param {prompt_eval_casesFindFirstArgs} args - Arguments to find a Prompt_eval_cases
     * @example
     * // Get one Prompt_eval_cases
     * const prompt_eval_cases = await prisma.prompt_eval_cases.findFirst({
     *   where: {
     *     // ... provide filter here
     *   }
     * })
     */
    findFirst<T extends prompt_eval_casesFindFirstArgs>(args?: SelectSubset<T, prompt_eval_casesFindFirstArgs<ExtArgs>>): Prisma__prompt_eval_casesClient<$Result.GetResult<Prisma.$prompt_eval_casesPayload<ExtArgs>, T, "findFirst"> | null, null, ExtArgs>

    /**
     * Find the first Prompt_eval_cases that matches the filter or
     * throw `PrismaKnownClientError` with `P2025` code if no matches were found.
     * Note, that providing `undefined` is treated as the value not being there.
     * Read more here: https://pris.ly/d/null-undefined
     * @param {prompt_eval_casesFindFirstOrThrowArgs} args - Arguments to find a Prompt_eval_cases
     * @example
     * // Get one Prompt_eval_cases
     * const prompt_eval_cases = await prisma.prompt_eval_cases.findFirstOrThrow({
     *   where: {
     *     // ... provide filter here
     *   }
     * })
     */
    findFirstOrThrow<T extends prompt_eval_casesFindFirstOrThrowArgs>(args?: SelectSubset<T, prompt_eval_casesFindFirstOrThrowArgs<ExtArgs>>): Prisma__prompt_eval_casesClient<$Result.GetResult<Prisma.$prompt_eval_casesPayload<ExtArgs>, T, "findFirstOrThrow">, never, ExtArgs>

    /**
     * Find zero or more Prompt_eval_cases that matches the filter.
     * Note, that providing `undefined` is treated as the value not being there.
     * Read more here: https://pris.ly/d/null-undefined
     * @param {prompt_eval_casesFindManyArgs} args - Arguments to filter and select certain fields only.
     * @example
     * // Get all Prompt_eval_cases
     * const prompt_eval_cases = await prisma.prompt_eval_cases.findMany()
     * 
     * // Get first 10 Prompt_eval_cases
     * const prompt_eval_cases = await prisma.prompt_eval_cases.findMany({ take: 10 })
     * 
     * // Only select the `id`
     * const prompt_eval_casesWithIdOnly = await prisma.prompt_eval_cases.findMany({ select: { id: true } })
     * 
     */
    findMany<T extends prompt_eval_casesFindManyArgs>(args?: SelectSubset<T, prompt_eval_casesFindManyArgs<ExtArgs>>): Prisma.PrismaPromise<$Result.GetResult<Prisma.$prompt_eval_casesPayload<ExtArgs>, T, "findMany">>

    /**
     * Create a Prompt_eval_cases.
     * @param {prompt_eval_casesCreateArgs} args - Arguments to create a Prompt_eval_cases.
     * @example
     * // Create one Prompt_eval_cases
     * const Prompt_eval_cases = await prisma.prompt_eval_cases.create({
     *   data: {
     *     // ... data to create a Prompt_eval_cases
     *   }
     * })
     * 
     */
    create<T extends prompt_eval_casesCreateArgs>(args: SelectSubset<T, prompt_eval_casesCreateArgs<ExtArgs>>): Prisma__prompt_eval_casesClient<$Result.GetResult<Prisma.$prompt_eval_casesPayload<ExtArgs>, T, "create">, never, ExtArgs>

    /**
     * Create many Prompt_eval_cases.
     * @param {prompt_eval_casesCreateManyArgs} args - Arguments to create many Prompt_eval_cases.
     * @example
     * // Create many Prompt_eval_cases
     * const prompt_eval_cases = await prisma.prompt_eval_cases.createMany({
     *   data: [
     *     // ... provide data here
     *   ]
     * })
     *     
     */
    createMany<T extends prompt_eval_casesCreateManyArgs>(args?: SelectSubset<T, prompt_eval_casesCreateManyArgs<ExtArgs>>): Prisma.PrismaPromise<BatchPayload>

    /**
     * Create many Prompt_eval_cases and returns the data saved in the database.
     * @param {prompt_eval_casesCreateManyAndReturnArgs} args - Arguments to create many Prompt_eval_cases.
     * @example
     * // Create many Prompt_eval_cases
     * const prompt_eval_cases = await prisma.prompt_eval_cases.createManyAndReturn({
     *   data: [
     *     // ... provide data here
     *   ]
     * })
     * 
     * // Create many Prompt_eval_cases and only return the `id`
     * const prompt_eval_casesWithIdOnly = await prisma.prompt_eval_cases.createManyAndReturn({ 
     *   select: { id: true },
     *   data: [
     *     // ... provide data here
     *   ]
     * })
     * Note, that providing `undefined` is treated as the value not being there.
     * Read more here: https://pris.ly/d/null-undefined
     * 
     */
    createManyAndReturn<T extends prompt_eval_casesCreateManyAndReturnArgs>(args?: SelectSubset<T, prompt_eval_casesCreateManyAndReturnArgs<ExtArgs>>): Prisma.PrismaPromise<$Result.GetResult<Prisma.$prompt_eval_casesPayload<ExtArgs>, T, "createManyAndReturn">>

    /**
     * Delete a Prompt_eval_cases.
     * @param {prompt_eval_casesDeleteArgs} args - Arguments to delete one Prompt_eval_cases.
     * @example
     * // Delete one Prompt_eval_cases
     * const Prompt_eval_cases = await prisma.prompt_eval_cases.delete({
     *   where: {
     *     // ... filter to delete one Prompt_eval_cases
     *   }
     * })
     * 
     */
    delete<T extends prompt_eval_casesDeleteArgs>(args: SelectSubset<T, prompt_eval_casesDeleteArgs<ExtArgs>>): Prisma__prompt_eval_casesClient<$Result.GetResult<Prisma.$prompt_eval_casesPayload<ExtArgs>, T, "delete">, never, ExtArgs>

    /**
     * Update one Prompt_eval_cases.
     * @param {prompt_eval_casesUpdateArgs} args - Arguments to update one Prompt_eval_cases.
     * @example
     * // Update one Prompt_eval_cases
     * const prompt_eval_cases = await prisma.prompt_eval_cases.update({
     *   where: {
     *     // ... provide filter here
     *   },
     *   data: {
     *     // ... provide data here
     *   }
     * })
     * 
     */
    update<T extends prompt_eval_casesUpdateArgs>(args: SelectSubset<T, prompt_eval_casesUpdateArgs<ExtArgs>>): Prisma__prompt_eval_casesClient<$Result.GetResult<Prisma.$prompt_eval_casesPayload<ExtArgs>, T, "update">, never, ExtArgs>

    /**
     * Delete zero or more Prompt_eval_cases.
     * @param {prompt_eval_casesDeleteManyArgs} args - Arguments to filter Prompt_eval_cases to delete.
     * @example
     * // Delete a few Prompt_eval_cases
     * const { count } = await prisma.prompt_eval_cases.deleteMany({
     *   where: {
     *     // ... provide filter here
     *   }
     * })
     * 
     */
    deleteMany<T extends prompt_eval_casesDeleteManyArgs>(args?: SelectSubset<T, prompt_eval_casesDeleteManyArgs<ExtArgs>>): Prisma.PrismaPromise<BatchPayload>

    /**
     * Update zero or more Prompt_eval_cases.
     * Note, that providing `undefined` is treated as the value not being there.
     * Read more here: https://pris.ly/d/null-undefined
     * @param {prompt_eval_casesUpdateManyArgs} args - Arguments to update one or more rows.
     * @example
     * // Update many Prompt_eval_cases
     * const prompt_eval_cases = await prisma.prompt_eval_cases.updateMany({
     *   where: {
     *     // ... provide filter here
     *   },
     *   data: {
     *     // ... provide data here
     *   }
     * })
     * 
     */
    updateMany<T extends prompt_eval_casesUpdateManyArgs>(args: SelectSubset<T, prompt_eval_casesUpdateManyArgs<ExtArgs>>): Prisma.PrismaPromise<BatchPayload>

    /**
     * Create or update one Prompt_eval_cases.
     * @param {prompt_eval_casesUpsertArgs} args - Arguments to update or create a Prompt_eval_cases.
     * @example
     * // Update or create a Prompt_eval_cases
     * const prompt_eval_cases = await prisma.prompt_eval_cases.upsert({
     *   create: {
     *     // ... data to create a Prompt_eval_cases
     *   },
     *   update: {
     *     // ... in case it already exists, update
     *   },
     *   where: {
     *     // ... the filter for the Prompt_eval_cases we want to update
     *   }
     * })
     */
    upsert<T extends prompt_eval_casesUpsertArgs>(args: SelectSubset<T, prompt_eval_casesUpsertArgs<ExtArgs>>): Prisma__prompt_eval_casesClient<$Result.GetResult<Prisma.$prompt_eval_casesPayload<ExtArgs>, T, "upsert">, never, ExtArgs>


    /**
     * Count the number of Prompt_eval_cases.
     * Note, that providing `undefined` is treated as the value not being there.
     * Read more here: https://pris.ly/d/null-undefined
     * @param {prompt_eval_casesCountArgs} args - Arguments to filter Prompt_eval_cases to count.
     * @example
     * // Count the number of Prompt_eval_cases
     * const count = await prisma.prompt_eval_cases.count({
     *   where: {
     *     // ... the filter for the Prompt_eval_cases we want to count
     *   }
     * })
    **/
    count<T extends prompt_eval_casesCountArgs>(
      args?: Subset<T, prompt_eval_casesCountArgs>,
    ): Prisma.PrismaPromise<
      T extends $Utils.Record<'select', any>
        ? T['select'] extends true
          ? number
          : GetScalarType<T['select'], Prompt_eval_casesCountAggregateOutputType>
        : number
    >

    /**
     * Allows you to perform aggregations operations on a Prompt_eval_cases.
     * Note, that providing `undefined` is treated as the value not being there.
     * Read more here: https://pris.ly/d/null-undefined
     * @param {Prompt_eval_casesAggregateArgs} args - Select which aggregations you would like to apply and on what fields.
     * @example
     * // Ordered by age ascending
     * // Where email contains prisma.io
     * // Limited to the 10 users
     * const aggregations = await prisma.user.aggregate({
     *   _avg: {
     *     age: true,
     *   },
     *   where: {
     *     email: {
     *       contains: "prisma.io",
     *     },
     *   },
     *   orderBy: {
     *     age: "asc",
     *   },
     *   take: 10,
     * })
    **/
    aggregate<T extends Prompt_eval_casesAggregateArgs>(args: Subset<T, Prompt_eval_casesAggregateArgs>): Prisma.PrismaPromise<GetPrompt_eval_casesAggregateType<T>>

    /**
     * Group by Prompt_eval_cases.
     * Note, that providing `undefined` is treated as the value not being there.
     * Read more here: https://pris.ly/d/null-undefined
     * @param {prompt_eval_casesGroupByArgs} args - Group by arguments.
     * @example
     * // Group by city, order by createdAt, get count
     * const result = await prisma.user.groupBy({
     *   by: ['city', 'createdAt'],
     *   orderBy: {
     *     createdAt: true
     *   },
     *   _count: {
     *     _all: true
     *   },
     * })
     * 
    **/
    groupBy<
      T extends prompt_eval_casesGroupByArgs,
      HasSelectOrTake extends Or<
        Extends<'skip', Keys<T>>,
        Extends<'take', Keys<T>>
      >,
      OrderByArg extends True extends HasSelectOrTake
        ? { orderBy: prompt_eval_casesGroupByArgs['orderBy'] }
        : { orderBy?: prompt_eval_casesGroupByArgs['orderBy'] },
      OrderFields extends ExcludeUnderscoreKeys<Keys<MaybeTupleToUnion<T['orderBy']>>>,
      ByFields extends MaybeTupleToUnion<T['by']>,
      ByValid extends Has<ByFields, OrderFields>,
      HavingFields extends GetHavingFields<T['having']>,
      HavingValid extends Has<ByFields, HavingFields>,
      ByEmpty extends T['by'] extends never[] ? True : False,
      InputErrors extends ByEmpty extends True
      ? `Error: "by" must not be empty.`
      : HavingValid extends False
      ? {
          [P in HavingFields]: P extends ByFields
            ? never
            : P extends string
            ? `Error: Field "${P}" used in "having" needs to be provided in "by".`
            : [
                Error,
                'Field ',
                P,
                ` in "having" needs to be provided in "by"`,
              ]
        }[HavingFields]
      : 'take' extends Keys<T>
      ? 'orderBy' extends Keys<T>
        ? ByValid extends True
          ? {}
          : {
              [P in OrderFields]: P extends ByFields
                ? never
                : `Error: Field "${P}" in "orderBy" needs to be provided in "by"`
            }[OrderFields]
        : 'Error: If you provide "take", you also need to provide "orderBy"'
      : 'skip' extends Keys<T>
      ? 'orderBy' extends Keys<T>
        ? ByValid extends True
          ? {}
          : {
              [P in OrderFields]: P extends ByFields
                ? never
                : `Error: Field "${P}" in "orderBy" needs to be provided in "by"`
            }[OrderFields]
        : 'Error: If you provide "skip", you also need to provide "orderBy"'
      : ByValid extends True
      ? {}
      : {
          [P in OrderFields]: P extends ByFields
            ? never
            : `Error: Field "${P}" in "orderBy" needs to be provided in "by"`
        }[OrderFields]
    >(args: SubsetIntersection<T, prompt_eval_casesGroupByArgs, OrderByArg> & InputErrors): {} extends InputErrors ? GetPrompt_eval_casesGroupByPayload<T> : Prisma.PrismaPromise<InputErrors>
  /**
   * Fields of the prompt_eval_cases model
   */
  readonly fields: prompt_eval_casesFieldRefs;
  }

  /**
   * The delegate class that acts as a "Promise-like" for prompt_eval_cases.
   * Why is this prefixed with `Prisma__`?
   * Because we want to prevent naming conflicts as mentioned in
   * https://github.com/prisma/prisma-client-js/issues/707
   */
  export interface Prisma__prompt_eval_casesClient<T, Null = never, ExtArgs extends $Extensions.InternalArgs = $Extensions.DefaultArgs> extends Prisma.PrismaPromise<T> {
    readonly [Symbol.toStringTag]: "PrismaPromise"
    /**
     * Attaches callbacks for the resolution and/or rejection of the Promise.
     * @param onfulfilled The callback to execute when the Promise is resolved.
     * @param onrejected The callback to execute when the Promise is rejected.
     * @returns A Promise for the completion of which ever callback is executed.
     */
    then<TResult1 = T, TResult2 = never>(onfulfilled?: ((value: T) => TResult1 | PromiseLike<TResult1>) | undefined | null, onrejected?: ((reason: any) => TResult2 | PromiseLike<TResult2>) | undefined | null): $Utils.JsPromise<TResult1 | TResult2>
    /**
     * Attaches a callback for only the rejection of the Promise.
     * @param onrejected The callback to execute when the Promise is rejected.
     * @returns A Promise for the completion of the callback.
     */
    catch<TResult = never>(onrejected?: ((reason: any) => TResult | PromiseLike<TResult>) | undefined | null): $Utils.JsPromise<T | TResult>
    /**
     * Attaches a callback that is invoked when the Promise is settled (fulfilled or rejected). The
     * resolved value cannot be modified from the callback.
     * @param onfinally The callback to execute when the Promise is settled (fulfilled or rejected).
     * @returns A Promise for the completion of the callback.
     */
    finally(onfinally?: (() => void) | undefined | null): $Utils.JsPromise<T>
  }




  /**
   * Fields of the prompt_eval_cases model
   */ 
  interface prompt_eval_casesFieldRefs {
    readonly id: FieldRef<"prompt_eval_cases", 'String'>
    readonly agentId: FieldRef<"prompt_eval_cases", 'String'>
    readonly caseId: FieldRef<"prompt_eval_cases", 'String'>
    readonly name: FieldRef<"prompt_eval_cases", 'String'>
    readonly description: FieldRef<"prompt_eval_cases", 'String'>
    readonly messagesJson: FieldRef<"prompt_eval_cases", 'String'>
    readonly previousStateJson: FieldRef<"prompt_eval_cases", 'String'>
    readonly expectationsJson: FieldRef<"prompt_eval_cases", 'String'>
    readonly enabled: FieldRef<"prompt_eval_cases", 'Boolean'>
    readonly createdBy: FieldRef<"prompt_eval_cases", 'String'>
    readonly createdAt: FieldRef<"prompt_eval_cases", 'DateTime'>
    readonly updatedAt: FieldRef<"prompt_eval_cases", 'DateTime'>
  }
    

  // Custom InputTypes
  /**
   * prompt_eval_cases findUnique
   */
  export type prompt_eval_casesFindUniqueArgs<ExtArgs extends $Extensions.InternalArgs = $Extensions.DefaultArgs> = {
    /**
     * Select specific fields to fetch from the prompt_eval_cases
     */
    select?: prompt_eval_casesSelect<ExtArgs> | null
    /**
     * Filter, which prompt_eval_cases to fetch.
     */
    where: prompt_eval_casesWhereUniqueInput
  }

  /**
   * prompt_eval_cases findUniqueOrThrow
   */
  export type prompt_eval_casesFindUniqueOrThrowArgs<ExtArgs extends $Extensions.InternalArgs = $Extensions.DefaultArgs> = {
    /**
     * Select specific fields to fetch from the prompt_eval_cases
     */
    select?: prompt_eval_casesSelect<ExtArgs> | null
    /**
     * Filter, which prompt_eval_cases to fetch.
     */
    where: prompt_eval_casesWhereUniqueInput
  }

  /**
   * prompt_eval_cases findFirst
   */
  export type prompt_eval_casesFindFirstArgs<ExtArgs extends $Extensions.InternalArgs = $Extensions.DefaultArgs> = {
    /**
     * Select specific fields to fetch from the prompt_eval_cases
     */
    select?: prompt_eval_casesSelect<ExtArgs> | null
    /**
     * Filter, which prompt_eval_cases to fetch.
     */
    where?: prompt_eval_casesWhereInput
    /**
     * {@link https://www.prisma.io/docs/concepts/components/prisma-client/sorting Sorting Docs}
     * 
     * Determine the order of prompt_eval_cases to fetch.
     */
    orderBy?: prompt_eval_casesOrderByWithRelationInput | prompt_eval_casesOrderByWithRelationInput[]
    /**
     * {@link https://www.prisma.io/docs/concepts/components/prisma-client/pagination#cursor-based-pagination Cursor Docs}
     * 
     * Sets the position for searching for prompt_eval_cases.
     */
    cursor?: prompt_eval_casesWhereUniqueInput
    /**
     * {@link https://www.prisma.io/docs/concepts/components/prisma-client/pagination Pagination Docs}
     * 
     * Take `±n` prompt_eval_cases from the position of the cursor.
     */
    take?: number
    /**
     * {@link https://www.prisma.io/docs/concepts/components/prisma-client/pagination Pagination Docs}
     * 
     * Skip the first `n` prompt_eval_cases.
     */
    skip?: number
    /**
     * {@link https://www.prisma.io/docs/concepts/components/prisma-client/distinct Distinct Docs}
     * 
     * Filter by unique combinations of prompt_eval_cases.
     */
    distinct?: Prompt_eval_casesScalarFieldEnum | Prompt_eval_casesScalarFieldEnum[]
  }

  /**
   * prompt_eval_cases findFirstOrThrow
   */
  export type prompt_eval_casesFindFirstOrThrowArgs<ExtArgs extends $Extensions.InternalArgs = $Extensions.DefaultArgs> = {
    /**
     * Select specific fields to fetch from the prompt_eval_cases
     */
    select?: prompt_eval_casesSelect<ExtArgs> | null
    /**
     * Filter, which prompt_eval_cases to fetch.
     */
    where?: prompt_eval_casesWhereInput
    /**
     * {@link https://www.prisma.io/docs/concepts/components/prisma-client/sorting Sorting Docs}
     * 
     * Determine the order of prompt_eval_cases to fetch.
     */
    orderBy?: prompt_eval_casesOrderByWithRelationInput | prompt_eval_casesOrderByWithRelationInput[]
    /**
     * {@link https://www.prisma.io/docs/concepts/components/prisma-client/pagination#cursor-based-pagination Cursor Docs}
     * 
     * Sets the position for searching for prompt_eval_cases.
     */
    cursor?: prompt_eval_casesWhereUniqueInput
    /**
     * {@link https://www.prisma.io/docs/concepts/components/prisma-client/pagination Pagination Docs}
     * 
     * Take `±n` prompt_eval_cases from the position of the cursor.
     */
    take?: number
    /**
     * {@link https://www.prisma.io/docs/concepts/components/prisma-client/pagination Pagination Docs}
     * 
     * Skip the first `n` prompt_eval_cases.
     */
    skip?: number
    /**
     * {@link https://www.prisma.io/docs/concepts/components/prisma-client/distinct Distinct Docs}
     * 
     * Filter by unique combinations of prompt_eval_cases.
     */
    distinct?: Prompt_eval_casesScalarFieldEnum | Prompt_eval_casesScalarFieldEnum[]
  }

  /**
   * prompt_eval_cases findMany
   */
  export type prompt_eval_casesFindManyArgs<ExtArgs extends $Extensions.InternalArgs = $Extensions.DefaultArgs> = {
    /**
     * Select specific fields to fetch from the prompt_eval_cases
     */
    select?: prompt_eval_casesSelect<ExtArgs> | null
    /**
     * Filter, which prompt_eval_cases to fetch.
     */
    where?: prompt_eval_casesWhereInput
    /**
     * {@link https://www.prisma.io/docs/concepts/components/prisma-client/sorting Sorting Docs}
     * 
     * Determine the order of prompt_eval_cases to fetch.
     */
    orderBy?: prompt_eval_casesOrderByWithRelationInput | prompt_eval_casesOrderByWithRelationInput[]
    /**
     * {@link https://www.prisma.io/docs/concepts/components/prisma-client/pagination#cursor-based-pagination Cursor Docs}
     * 
     * Sets the position for listing prompt_eval_cases.
     */
    cursor?: prompt_eval_casesWhereUniqueInput
    /**
     * {@link https://www.prisma.io/docs/concepts/components/prisma-client/pagination Pagination Docs}
     * 
     * Take `±n` prompt_eval_cases from the position of the cursor.
     */
    take?: number
    /**
     * {@link https://www.prisma.io/docs/concepts/components/prisma-client/pagination Pagination Docs}
     * 
     * Skip the first `n` prompt_eval_cases.
     */
    skip?: number
    distinct?: Prompt_eval_casesScalarFieldEnum | Prompt_eval_casesScalarFieldEnum[]
  }

  /**
   * prompt_eval_cases create
   */
  export type prompt_eval_casesCreateArgs<ExtArgs extends $Extensions.InternalArgs = $Extensions.DefaultArgs> = {
    /**
     * Select specific fields to fetch from the prompt_eval_cases
     */
    select?: prompt_eval_casesSelect<ExtArgs> | null
    /**
     * The data needed to create a prompt_eval_cases.
     */
    data: XOR<prompt_eval_casesCreateInput, prompt_eval_casesUncheckedCreateInput>
  }

  /**
   * prompt_eval_cases createMany
   */
  export type prompt_eval_casesCreateManyArgs<ExtArgs extends $Extensions.InternalArgs = $Extensions.DefaultArgs> = {
    /**
     * The data used to create many prompt_eval_cases.
     */
    data: prompt_eval_casesCreateManyInput | prompt_eval_casesCreateManyInput[]
  }

  /**
   * prompt_eval_cases createManyAndReturn
   */
  export type prompt_eval_casesCreateManyAndReturnArgs<ExtArgs extends $Extensions.InternalArgs = $Extensions.DefaultArgs> = {
    /**
     * Select specific fields to fetch from the prompt_eval_cases
     */
    select?: prompt_eval_casesSelectCreateManyAndReturn<ExtArgs> | null
    /**
     * The data used to create many prompt_eval_cases.
     */
    data: prompt_eval_casesCreateManyInput | prompt_eval_casesCreateManyInput[]
  }

  /**
   * prompt_eval_cases update
   */
  export type prompt_eval_casesUpdateArgs<ExtArgs extends $Extensions.InternalArgs = $Extensions.DefaultArgs> = {
    /**
     * Select specific fields to fetch from the prompt_eval_cases
     */
    select?: prompt_eval_casesSelect<ExtArgs> | null
    /**
     * The data needed to update a prompt_eval_cases.
     */
    data: XOR<prompt_eval_casesUpdateInput, prompt_eval_casesUncheckedUpdateInput>
    /**
     * Choose, which prompt_eval_cases to update.
     */
    where: prompt_eval_casesWhereUniqueInput
  }

  /**
   * prompt_eval_cases updateMany
   */
  export type prompt_eval_casesUpdateManyArgs<ExtArgs extends $Extensions.InternalArgs = $Extensions.DefaultArgs> = {
    /**
     * The data used to update prompt_eval_cases.
     */
    data: XOR<prompt_eval_casesUpdateManyMutationInput, prompt_eval_casesUncheckedUpdateManyInput>
    /**
     * Filter which prompt_eval_cases to update
     */
    where?: prompt_eval_casesWhereInput
  }

  /**
   * prompt_eval_cases upsert
   */
  export type prompt_eval_casesUpsertArgs<ExtArgs extends $Extensions.InternalArgs = $Extensions.DefaultArgs> = {
    /**
     * Select specific fields to fetch from the prompt_eval_cases
     */
    select?: prompt_eval_casesSelect<ExtArgs> | null
    /**
     * The filter to search for the prompt_eval_cases to update in case it exists.
     */
    where: prompt_eval_casesWhereUniqueInput
    /**
     * In case the prompt_eval_cases found by the `where` argument doesn't exist, create a new prompt_eval_cases with this data.
     */
    create: XOR<prompt_eval_casesCreateInput, prompt_eval_casesUncheckedCreateInput>
    /**
     * In case the prompt_eval_cases was found with the provided `where` argument, update it with this data.
     */
    update: XOR<prompt_eval_casesUpdateInput, prompt_eval_casesUncheckedUpdateInput>
  }

  /**
   * prompt_eval_cases delete
   */
  export type prompt_eval_casesDeleteArgs<ExtArgs extends $Extensions.InternalArgs = $Extensions.DefaultArgs> = {
    /**
     * Select specific fields to fetch from the prompt_eval_cases
     */
    select?: prompt_eval_casesSelect<ExtArgs> | null
    /**
     * Filter which prompt_eval_cases to delete.
     */
    where: prompt_eval_casesWhereUniqueInput
  }

  /**
   * prompt_eval_cases deleteMany
   */
  export type prompt_eval_casesDeleteManyArgs<ExtArgs extends $Extensions.InternalArgs = $Extensions.DefaultArgs> = {
    /**
     * Filter which prompt_eval_cases to delete
     */
    where?: prompt_eval_casesWhereInput
  }

  /**
   * prompt_eval_cases without action
   */
  export type prompt_eval_casesDefaultArgs<ExtArgs extends $Extensions.InternalArgs = $Extensions.DefaultArgs> = {
    /**
     * Select specific fields to fetch from the prompt_eval_cases
     */
    select?: prompt_eval_casesSelect<ExtArgs> | null
  }


  /**
   * Model prompt_eval_runs
   */

  export type AggregatePrompt_eval_runs = {
    _count: Prompt_eval_runsCountAggregateOutputType | null
    _avg: Prompt_eval_runsAvgAggregateOutputType | null
    _sum: Prompt_eval_runsSumAggregateOutputType | null
    _min: Prompt_eval_runsMinAggregateOutputType | null
    _max: Prompt_eval_runsMaxAggregateOutputType | null
  }

  export type Prompt_eval_runsAvgAggregateOutputType = {
    promptVersion: number | null
    caseCount: number | null
    totalRuns: number | null
    durationMs: number | null
  }

  export type Prompt_eval_runsSumAggregateOutputType = {
    promptVersion: number | null
    caseCount: number | null
    totalRuns: number | null
    durationMs: number | null
  }

  export type Prompt_eval_runsMinAggregateOutputType = {
    id: string | null
    agentId: string | null
    promptVersionId: string | null
    promptVersion: number | null
    promptSource: string | null
    mode: string | null
    caseCount: number | null
    totalRuns: number | null
    summaryJson: string | null
    resultsJson: string | null
    durationMs: number | null
    triggeredBy: string | null
    createdAt: Date | null
  }

  export type Prompt_eval_runsMaxAggregateOutputType = {
    id: string | null
    agentId: string | null
    promptVersionId: string | null
    promptVersion: number | null
    promptSource: string | null
    mode: string | null
    caseCount: number | null
    totalRuns: number | null
    summaryJson: string | null
    resultsJson: string | null
    durationMs: number | null
    triggeredBy: string | null
    createdAt: Date | null
  }

  export type Prompt_eval_runsCountAggregateOutputType = {
    id: number
    agentId: number
    promptVersionId: number
    promptVersion: number
    promptSource: number
    mode: number
    caseCount: number
    totalRuns: number
    summaryJson: number
    resultsJson: number
    durationMs: number
    triggeredBy: number
    createdAt: number
    _all: number
  }


  export type Prompt_eval_runsAvgAggregateInputType = {
    promptVersion?: true
    caseCount?: true
    totalRuns?: true
    durationMs?: true
  }

  export type Prompt_eval_runsSumAggregateInputType = {
    promptVersion?: true
    caseCount?: true
    totalRuns?: true
    durationMs?: true
  }

  export type Prompt_eval_runsMinAggregateInputType = {
    id?: true
    agentId?: true
    promptVersionId?: true
    promptVersion?: true
    promptSource?: true
    mode?: true
    caseCount?: true
    totalRuns?: true
    summaryJson?: true
    resultsJson?: true
    durationMs?: true
    triggeredBy?: true
    createdAt?: true
  }

  export type Prompt_eval_runsMaxAggregateInputType = {
    id?: true
    agentId?: true
    promptVersionId?: true
    promptVersion?: true
    promptSource?: true
    mode?: true
    caseCount?: true
    totalRuns?: true
    summaryJson?: true
    resultsJson?: true
    durationMs?: true
    triggeredBy?: true
    createdAt?: true
  }

  export type Prompt_eval_runsCountAggregateInputType = {
    id?: true
    agentId?: true
    promptVersionId?: true
    promptVersion?: true
    promptSource?: true
    mode?: true
    caseCount?: true
    totalRuns?: true
    summaryJson?: true
    resultsJson?: true
    durationMs?: true
    triggeredBy?: true
    createdAt?: true
    _all?: true
  }

  export type Prompt_eval_runsAggregateArgs<ExtArgs extends $Extensions.InternalArgs = $Extensions.DefaultArgs> = {
    /**
     * Filter which prompt_eval_runs to aggregate.
     */
    where?: prompt_eval_runsWhereInput
    /**
     * {@link https://www.prisma.io/docs/concepts/components/prisma-client/sorting Sorting Docs}
     * 
     * Determine the order of prompt_eval_runs to fetch.
     */
    orderBy?: prompt_eval_runsOrderByWithRelationInput | prompt_eval_runsOrderByWithRelationInput[]
    /**
     * {@link https://www.prisma.io/docs/concepts/components/prisma-client/pagination#cursor-based-pagination Cursor Docs}
     * 
     * Sets the start position
     */
    cursor?: prompt_eval_runsWhereUniqueInput
    /**
     * {@link https://www.prisma.io/docs/concepts/components/prisma-client/pagination Pagination Docs}
     * 
     * Take `±n` prompt_eval_runs from the position of the cursor.
     */
    take?: number
    /**
     * {@link https://www.prisma.io/docs/concepts/components/prisma-client/pagination Pagination Docs}
     * 
     * Skip the first `n` prompt_eval_runs.
     */
    skip?: number
    /**
     * {@link https://www.prisma.io/docs/concepts/components/prisma-client/aggregations Aggregation Docs}
     * 
     * Count returned prompt_eval_runs
    **/
    _count?: true | Prompt_eval_runsCountAggregateInputType
    /**
     * {@link https://www.prisma.io/docs/concepts/components/prisma-client/aggregations Aggregation Docs}
     * 
     * Select which fields to average
    **/
    _avg?: Prompt_eval_runsAvgAggregateInputType
    /**
     * {@link https://www.prisma.io/docs/concepts/components/prisma-client/aggregations Aggregation Docs}
     * 
     * Select which fields to sum
    **/
    _sum?: Prompt_eval_runsSumAggregateInputType
    /**
     * {@link https://www.prisma.io/docs/concepts/components/prisma-client/aggregations Aggregation Docs}
     * 
     * Select which fields to find the minimum value
    **/
    _min?: Prompt_eval_runsMinAggregateInputType
    /**
     * {@link https://www.prisma.io/docs/concepts/components/prisma-client/aggregations Aggregation Docs}
     * 
     * Select which fields to find the maximum value
    **/
    _max?: Prompt_eval_runsMaxAggregateInputType
  }

  export type GetPrompt_eval_runsAggregateType<T extends Prompt_eval_runsAggregateArgs> = {
        [P in keyof T & keyof AggregatePrompt_eval_runs]: P extends '_count' | 'count'
      ? T[P] extends true
        ? number
        : GetScalarType<T[P], AggregatePrompt_eval_runs[P]>
      : GetScalarType<T[P], AggregatePrompt_eval_runs[P]>
  }




  export type prompt_eval_runsGroupByArgs<ExtArgs extends $Extensions.InternalArgs = $Extensions.DefaultArgs> = {
    where?: prompt_eval_runsWhereInput
    orderBy?: prompt_eval_runsOrderByWithAggregationInput | prompt_eval_runsOrderByWithAggregationInput[]
    by: Prompt_eval_runsScalarFieldEnum[] | Prompt_eval_runsScalarFieldEnum
    having?: prompt_eval_runsScalarWhereWithAggregatesInput
    take?: number
    skip?: number
    _count?: Prompt_eval_runsCountAggregateInputType | true
    _avg?: Prompt_eval_runsAvgAggregateInputType
    _sum?: Prompt_eval_runsSumAggregateInputType
    _min?: Prompt_eval_runsMinAggregateInputType
    _max?: Prompt_eval_runsMaxAggregateInputType
  }

  export type Prompt_eval_runsGroupByOutputType = {
    id: string
    agentId: string
    promptVersionId: string | null
    promptVersion: number | null
    promptSource: string
    mode: string
    caseCount: number
    totalRuns: number
    summaryJson: string
    resultsJson: string | null
    durationMs: number
    triggeredBy: string | null
    createdAt: Date
    _count: Prompt_eval_runsCountAggregateOutputType | null
    _avg: Prompt_eval_runsAvgAggregateOutputType | null
    _sum: Prompt_eval_runsSumAggregateOutputType | null
    _min: Prompt_eval_runsMinAggregateOutputType | null
    _max: Prompt_eval_runsMaxAggregateOutputType | null
  }

  type GetPrompt_eval_runsGroupByPayload<T extends prompt_eval_runsGroupByArgs> = Prisma.PrismaPromise<
    Array<
      PickEnumerable<Prompt_eval_runsGroupByOutputType, T['by']> &
        {
          [P in ((keyof T) & (keyof Prompt_eval_runsGroupByOutputType))]: P extends '_count'
            ? T[P] extends boolean
              ? number
              : GetScalarType<T[P], Prompt_eval_runsGroupByOutputType[P]>
            : GetScalarType<T[P], Prompt_eval_runsGroupByOutputType[P]>
        }
      >
    >


  export type prompt_eval_runsSelect<ExtArgs extends $Extensions.InternalArgs = $Extensions.DefaultArgs> = $Extensions.GetSelect<{
    id?: boolean
    agentId?: boolean
    promptVersionId?: boolean
    promptVersion?: boolean
    promptSource?: boolean
    mode?: boolean
    caseCount?: boolean
    totalRuns?: boolean
    summaryJson?: boolean
    resultsJson?: boolean
    durationMs?: boolean
    triggeredBy?: boolean
    createdAt?: boolean
  }, ExtArgs["result"]["prompt_eval_runs"]>

  export type prompt_eval_runsSelectCreateManyAndReturn<ExtArgs extends $Extensions.InternalArgs = $Extensions.DefaultArgs> = $Extensions.GetSelect<{
    id?: boolean
    agentId?: boolean
    promptVersionId?: boolean
    promptVersion?: boolean
    promptSource?: boolean
    mode?: boolean
    caseCount?: boolean
    totalRuns?: boolean
    summaryJson?: boolean
    resultsJson?: boolean
    durationMs?: boolean
    triggeredBy?: boolean
    createdAt?: boolean
  }, ExtArgs["result"]["prompt_eval_runs"]>

  export type prompt_eval_runsSelectScalar = {
    id?: boolean
    agentId?: boolean
    promptVersionId?: boolean
    promptVersion?: boolean
    promptSource?: boolean
    mode?: boolean
    caseCount?: boolean
    totalRuns?: boolean
    summaryJson?: boolean
    resultsJson?: boolean
    durationMs?: boolean
    triggeredBy?: boolean
    createdAt?: boolean
  }


  export type $prompt_eval_runsPayload<ExtArgs extends $Extensions.InternalArgs = $Extensions.DefaultArgs> = {
    name: "prompt_eval_runs"
    objects: {}
    scalars: $Extensions.GetPayloadResult<{
      id: string
      agentId: string
      promptVersionId: string | null
      promptVersion: number | null
      promptSource: string
      mode: string
      caseCount: number
      totalRuns: number
      summaryJson: string
      resultsJson: string | null
      durationMs: number
      triggeredBy: string | null
      createdAt: Date
    }, ExtArgs["result"]["prompt_eval_runs"]>
    composites: {}
  }

  type prompt_eval_runsGetPayload<S extends boolean | null | undefined | prompt_eval_runsDefaultArgs> = $Result.GetResult<Prisma.$prompt_eval_runsPayload, S>

  type prompt_eval_runsCountArgs<ExtArgs extends $Extensions.InternalArgs = $Extensions.DefaultArgs> = 
    Omit<prompt_eval_runsFindManyArgs, 'select' | 'include' | 'distinct'> & {
      select?: Prompt_eval_runsCountAggregateInputType | true
    }

  export interface prompt_eval_runsDelegate<ExtArgs extends $Extensions.InternalArgs = $Extensions.DefaultArgs> {
    [K: symbol]: { types: Prisma.TypeMap<ExtArgs>['model']['prompt_eval_runs'], meta: { name: 'prompt_eval_runs' } }
    /**
     * Find zero or one Prompt_eval_runs that matches the filter.
     * @param {prompt_eval_runsFindUniqueArgs} args - Arguments to find a Prompt_eval_runs
     * @example
     * // Get one Prompt_eval_runs
     * const prompt_eval_runs = await prisma.prompt_eval_runs.findUnique({
     *   where: {
     *     // ... provide filter here
     *   }
     * })
     */
    findUnique<T extends prompt_eval_runsFindUniqueArgs>(args: SelectSubset<T, prompt_eval_runsFindUniqueArgs<ExtArgs>>): Prisma__prompt_eval_runsClient<$Result.GetResult<Prisma.$prompt_eval_runsPayload<ExtArgs>, T, "findUnique"> | null, null, ExtArgs>

    /**
     * Find one Prompt_eval_runs that matches the filter or throw an error with `error.code='P2025'` 
     * if no matches were found.
     * @param {prompt_eval_runsFindUniqueOrThrowArgs} args - Arguments to find a Prompt_eval_runs
     * @example
     * // Get one Prompt_eval_runs
     * const prompt_eval_runs = await prisma.prompt_eval_runs.findUniqueOrThrow({
     *   where: {
     *     // ... provide filter here
     *   }
     * })
     */
    findUniqueOrThrow<T extends prompt_eval_runsFindUniqueOrThrowArgs>(args: SelectSubset<T, prompt_eval_runsFindUniqueOrThrowArgs<ExtArgs>>): Prisma__prompt_eval_runsClient<$Result.GetResult<Prisma.$prompt_eval_runsPayload<ExtArgs>, T, "findUniqueOrThrow">, never, ExtArgs>

    /**
     * Find the first Prompt_eval_runs that matches the filter.
     * Note, that providing `undefined` is treated as the value not being there.
     * Read more here: https://pris.ly/d/null-undefined
     * @param {prompt_eval_runsFindFirstArgs} args - Arguments to find a Prompt_eval_runs
     * @example
     * // Get one Prompt_eval_runs
     * const prompt_eval_runs = await prisma.prompt_eval_runs.findFirst({
     *   where: {
     *     // ... provide filter here
     *   }
     * })
     */
    findFirst<T extends prompt_eval_runsFindFirstArgs>(args?: SelectSubset<T, prompt_eval_runsFindFirstArgs<ExtArgs>>): Prisma__prompt_eval_runsClient<$Result.GetResult<Prisma.$prompt_eval_runsPayload<ExtArgs>, T, "findFirst"> | null, null, ExtArgs>

    /**
     * Find the first Prompt_eval_runs that matches the filter or
     * throw `PrismaKnownClientError` with `P2025` code if no matches were found.
     * Note, that providing `undefined` is treated as the value not being there.
     * Read more here: https://pris.ly/d/null-undefined
     * @param {prompt_eval_runsFindFirstOrThrowArgs} args - Arguments to find a Prompt_eval_runs
     * @example
     * // Get one Prompt_eval_runs
     * const prompt_eval_runs = await prisma.prompt_eval_runs.findFirstOrThrow({
     *   where: {
     *     // ... provide filter here
     *   }
     * })
     */
    findFirstOrThrow<T extends prompt_eval_runsFindFirstOrThrowArgs>(args?: SelectSubset<T, prompt_eval_runsFindFirstOrThrowArgs<ExtArgs>>): Prisma__prompt_eval_runsClient<$Result.GetResult<Prisma.$prompt_eval_runsPayload<ExtArgs>, T, "findFirstOrThrow">, never, ExtArgs>

    /**
     * Find zero or more Prompt_eval_runs that matches the filter.
     * Note, that providing `undefined` is treated as the value not being there.
     * Read more here: https://pris.ly/d/null-undefined
     * @param {prompt_eval_runsFindManyArgs} args - Arguments to filter and select certain fields only.
     * @example
     * // Get all Prompt_eval_runs
     * const prompt_eval_runs = await prisma.prompt_eval_runs.findMany()
     * 
     * // Get first 10 Prompt_eval_runs
     * const prompt_eval_runs = await prisma.prompt_eval_runs.findMany({ take: 10 })
     * 
     * // Only select the `id`
     * const prompt_eval_runsWithIdOnly = await prisma.prompt_eval_runs.findMany({ select: { id: true } })
     * 
     */
    findMany<T extends prompt_eval_runsFindManyArgs>(args?: SelectSubset<T, prompt_eval_runsFindManyArgs<ExtArgs>>): Prisma.PrismaPromise<$Result.GetResult<Prisma.$prompt_eval_runsPayload<ExtArgs>, T, "findMany">>

    /**
     * Create a Prompt_eval_runs.
     * @param {prompt_eval_runsCreateArgs} args - Arguments to create a Prompt_eval_runs.
     * @example
     * // Create one Prompt_eval_runs
     * const Prompt_eval_runs = await prisma.prompt_eval_runs.create({
     *   data: {
     *     // ... data to create a Prompt_eval_runs
     *   }
     * })
     * 
     */
    create<T extends prompt_eval_runsCreateArgs>(args: SelectSubset<T, prompt_eval_runsCreateArgs<ExtArgs>>): Prisma__prompt_eval_runsClient<$Result.GetResult<Prisma.$prompt_eval_runsPayload<ExtArgs>, T, "create">, never, ExtArgs>

    /**
     * Create many Prompt_eval_runs.
     * @param {prompt_eval_runsCreateManyArgs} args - Arguments to create many Prompt_eval_runs.
     * @example
     * // Create many Prompt_eval_runs
     * const prompt_eval_runs = await prisma.prompt_eval_runs.createMany({
     *   data: [
     *     // ... provide data here
     *   ]
     * })
     *     
     */
    createMany<T extends prompt_eval_runsCreateManyArgs>(args?: SelectSubset<T, prompt_eval_runsCreateManyArgs<ExtArgs>>): Prisma.PrismaPromise<BatchPayload>

    /**
     * Create many Prompt_eval_runs and returns the data saved in the database.
     * @param {prompt_eval_runsCreateManyAndReturnArgs} args - Arguments to create many Prompt_eval_runs.
     * @example
     * // Create many Prompt_eval_runs
     * const prompt_eval_runs = await prisma.prompt_eval_runs.createManyAndReturn({
     *   data: [
     *     // ... provide data here
     *   ]
     * })
     * 
     * // Create many Prompt_eval_runs and only return the `id`
     * const prompt_eval_runsWithIdOnly = await prisma.prompt_eval_runs.createManyAndReturn({ 
     *   select: { id: true },
     *   data: [
     *     // ... provide data here
     *   ]
     * })
     * Note, that providing `undefined` is treated as the value not being there.
     * Read more here: https://pris.ly/d/null-undefined
     * 
     */
    createManyAndReturn<T extends prompt_eval_runsCreateManyAndReturnArgs>(args?: SelectSubset<T, prompt_eval_runsCreateManyAndReturnArgs<ExtArgs>>): Prisma.PrismaPromise<$Result.GetResult<Prisma.$prompt_eval_runsPayload<ExtArgs>, T, "createManyAndReturn">>

    /**
     * Delete a Prompt_eval_runs.
     * @param {prompt_eval_runsDeleteArgs} args - Arguments to delete one Prompt_eval_runs.
     * @example
     * // Delete one Prompt_eval_runs
     * const Prompt_eval_runs = await prisma.prompt_eval_runs.delete({
     *   where: {
     *     // ... filter to delete one Prompt_eval_runs
     *   }
     * })
     * 
     */
    delete<T extends prompt_eval_runsDeleteArgs>(args: SelectSubset<T, prompt_eval_runsDeleteArgs<ExtArgs>>): Prisma__prompt_eval_runsClient<$Result.GetResult<Prisma.$prompt_eval_runsPayload<ExtArgs>, T, "delete">, never, ExtArgs>

    /**
     * Update one Prompt_eval_runs.
     * @param {prompt_eval_runsUpdateArgs} args - Arguments to update one Prompt_eval_runs.
     * @example
     * // Update one Prompt_eval_runs
     * const prompt_eval_runs = await prisma.prompt_eval_runs.update({
     *   where: {
     *     // ... provide filter here
     *   },
     *   data: {
     *     // ... provide data here
     *   }
     * })
     * 
     */
    update<T extends prompt_eval_runsUpdateArgs>(args: SelectSubset<T, prompt_eval_runsUpdateArgs<ExtArgs>>): Prisma__prompt_eval_runsClient<$Result.GetResult<Prisma.$prompt_eval_runsPayload<ExtArgs>, T, "update">, never, ExtArgs>

    /**
     * Delete zero or more Prompt_eval_runs.
     * @param {prompt_eval_runsDeleteManyArgs} args - Arguments to filter Prompt_eval_runs to delete.
     * @example
     * // Delete a few Prompt_eval_runs
     * const { count } = await prisma.prompt_eval_runs.deleteMany({
     *   where: {
     *     // ... provide filter here
     *   }
     * })
     * 
     */
    deleteMany<T extends prompt_eval_runsDeleteManyArgs>(args?: SelectSubset<T, prompt_eval_runsDeleteManyArgs<ExtArgs>>): Prisma.PrismaPromise<BatchPayload>

    /**
     * Update zero or more Prompt_eval_runs.
     * Note, that providing `undefined` is treated as the value not being there.
     * Read more here: https://pris.ly/d/null-undefined
     * @param {prompt_eval_runsUpdateManyArgs} args - Arguments to update one or more rows.
     * @example
     * // Update many Prompt_eval_runs
     * const prompt_eval_runs = await prisma.prompt_eval_runs.updateMany({
     *   where: {
     *     // ... provide filter here
     *   },
     *   data: {
     *     // ... provide data here
     *   }
     * })
     * 
     */
    updateMany<T extends prompt_eval_runsUpdateManyArgs>(args: SelectSubset<T, prompt_eval_runsUpdateManyArgs<ExtArgs>>): Prisma.PrismaPromise<BatchPayload>

    /**
     * Create or update one Prompt_eval_runs.
     * @param {prompt_eval_runsUpsertArgs} args - Arguments to update or create a Prompt_eval_runs.
     * @example
     * // Update or create a Prompt_eval_runs
     * const prompt_eval_runs = await prisma.prompt_eval_runs.upsert({
     *   create: {
     *     // ... data to create a Prompt_eval_runs
     *   },
     *   update: {
     *     // ... in case it already exists, update
     *   },
     *   where: {
     *     // ... the filter for the Prompt_eval_runs we want to update
     *   }
     * })
     */
    upsert<T extends prompt_eval_runsUpsertArgs>(args: SelectSubset<T, prompt_eval_runsUpsertArgs<ExtArgs>>): Prisma__prompt_eval_runsClient<$Result.GetResult<Prisma.$prompt_eval_runsPayload<ExtArgs>, T, "upsert">, never, ExtArgs>


    /**
     * Count the number of Prompt_eval_runs.
     * Note, that providing `undefined` is treated as the value not being there.
     * Read more here: https://pris.ly/d/null-undefined
     * @param {prompt_eval_runsCountArgs} args - Arguments to filter Prompt_eval_runs to count.
     * @example
     * // Count the number of Prompt_eval_runs
     * const count = await prisma.prompt_eval_runs.count({
     *   where: {
     *     // ... the filter for the Prompt_eval_runs we want to count
     *   }
     * })
    **/
    count<T extends prompt_eval_runsCountArgs>(
      args?: Subset<T, prompt_eval_runsCountArgs>,
    ): Prisma.PrismaPromise<
      T extends $Utils.Record<'select', any>
        ? T['select'] extends true
          ? number
          : GetScalarType<T['select'], Prompt_eval_runsCountAggregateOutputType>
        : number
    >

    /**
     * Allows you to perform aggregations operations on a Prompt_eval_runs.
     * Note, that providing `undefined` is treated as the value not being there.
     * Read more here: https://pris.ly/d/null-undefined
     * @param {Prompt_eval_runsAggregateArgs} args - Select which aggregations you would like to apply and on what fields.
     * @example
     * // Ordered by age ascending
     * // Where email contains prisma.io
     * // Limited to the 10 users
     * const aggregations = await prisma.user.aggregate({
     *   _avg: {
     *     age: true,
     *   },
     *   where: {
     *     email: {
     *       contains: "prisma.io",
     *     },
     *   },
     *   orderBy: {
     *     age: "asc",
     *   },
     *   take: 10,
     * })
    **/
    aggregate<T extends Prompt_eval_runsAggregateArgs>(args: Subset<T, Prompt_eval_runsAggregateArgs>): Prisma.PrismaPromise<GetPrompt_eval_runsAggregateType<T>>

    /**
     * Group by Prompt_eval_runs.
     * Note, that providing `undefined` is treated as the value not being there.
     * Read more here: https://pris.ly/d/null-undefined
     * @param {prompt_eval_runsGroupByArgs} args - Group by arguments.
     * @example
     * // Group by city, order by createdAt, get count
     * const result = await prisma.user.groupBy({
     *   by: ['city', 'createdAt'],
     *   orderBy: {
     *     createdAt: true
     *   },
     *   _count: {
     *     _all: true
     *   },
     * })
     * 
    **/
    groupBy<
      T extends prompt_eval_runsGroupByArgs,
      HasSelectOrTake extends Or<
        Extends<'skip', Keys<T>>,
        Extends<'take', Keys<T>>
      >,
      OrderByArg extends True extends HasSelectOrTake
        ? { orderBy: prompt_eval_runsGroupByArgs['orderBy'] }
        : { orderBy?: prompt_eval_runsGroupByArgs['orderBy'] },
      OrderFields extends ExcludeUnderscoreKeys<Keys<MaybeTupleToUnion<T['orderBy']>>>,
      ByFields extends MaybeTupleToUnion<T['by']>,
      ByValid extends Has<ByFields, OrderFields>,
      HavingFields extends GetHavingFields<T['having']>,
      HavingValid extends Has<ByFields, HavingFields>,
      ByEmpty extends T['by'] extends never[] ? True : False,
      InputErrors extends ByEmpty extends True
      ? `Error: "by" must not be empty.`
      : HavingValid extends False
      ? {
          [P in HavingFields]: P extends ByFields
            ? never
            : P extends string
            ? `Error: Field "${P}" used in "having" needs to be provided in "by".`
            : [
                Error,
                'Field ',
                P,
                ` in "having" needs to be provided in "by"`,
              ]
        }[HavingFields]
      : 'take' extends Keys<T>
      ? 'orderBy' extends Keys<T>
        ? ByValid extends True
          ? {}
          : {
              [P in OrderFields]: P extends ByFields
                ? never
                : `Error: Field "${P}" in "orderBy" needs to be provided in "by"`
            }[OrderFields]
        : 'Error: If you provide "take", you also need to provide "orderBy"'
      : 'skip' extends Keys<T>
      ? 'orderBy' extends Keys<T>
        ? ByValid extends True
          ? {}
          : {
              [P in OrderFields]: P extends ByFields
                ? never
                : `Error: Field "${P}" in "orderBy" needs to be provided in "by"`
            }[OrderFields]
        : 'Error: If you provide "skip", you also need to provide "orderBy"'
      : ByValid extends True
      ? {}
      : {
          [P in OrderFields]: P extends ByFields
            ? never
            : `Error: Field "${P}" in "orderBy" needs to be provided in "by"`
        }[OrderFields]
    >(args: SubsetIntersection<T, prompt_eval_runsGroupByArgs, OrderByArg> & InputErrors): {} extends InputErrors ? GetPrompt_eval_runsGroupByPayload<T> : Prisma.PrismaPromise<InputErrors>
  /**
   * Fields of the prompt_eval_runs model
   */
  readonly fields: prompt_eval_runsFieldRefs;
  }

  /**
   * The delegate class that acts as a "Promise-like" for prompt_eval_runs.
   * Why is this prefixed with `Prisma__`?
   * Because we want to prevent naming conflicts as mentioned in
   * https://github.com/prisma/prisma-client-js/issues/707
   */
  export interface Prisma__prompt_eval_runsClient<T, Null = never, ExtArgs extends $Extensions.InternalArgs = $Extensions.DefaultArgs> extends Prisma.PrismaPromise<T> {
    readonly [Symbol.toStringTag]: "PrismaPromise"
    /**
     * Attaches callbacks for the resolution and/or rejection of the Promise.
     * @param onfulfilled The callback to execute when the Promise is resolved.
     * @param onrejected The callback to execute when the Promise is rejected.
     * @returns A Promise for the completion of which ever callback is executed.
     */
    then<TResult1 = T, TResult2 = never>(onfulfilled?: ((value: T) => TResult1 | PromiseLike<TResult1>) | undefined | null, onrejected?: ((reason: any) => TResult2 | PromiseLike<TResult2>) | undefined | null): $Utils.JsPromise<TResult1 | TResult2>
    /**
     * Attaches a callback for only the rejection of the Promise.
     * @param onrejected The callback to execute when the Promise is rejected.
     * @returns A Promise for the completion of the callback.
     */
    catch<TResult = never>(onrejected?: ((reason: any) => TResult | PromiseLike<TResult>) | undefined | null): $Utils.JsPromise<T | TResult>
    /**
     * Attaches a callback that is invoked when the Promise is settled (fulfilled or rejected). The
     * resolved value cannot be modified from the callback.
     * @param onfinally The callback to execute when the Promise is settled (fulfilled or rejected).
     * @returns A Promise for the completion of the callback.
     */
    finally(onfinally?: (() => void) | undefined | null): $Utils.JsPromise<T>
  }




  /**
   * Fields of the prompt_eval_runs model
   */ 
  interface prompt_eval_runsFieldRefs {
    readonly id: FieldRef<"prompt_eval_runs", 'String'>
    readonly agentId: FieldRef<"prompt_eval_runs", 'String'>
    readonly promptVersionId: FieldRef<"prompt_eval_runs", 'String'>
    readonly promptVersion: FieldRef<"prompt_eval_runs", 'Int'>
    readonly promptSource: FieldRef<"prompt_eval_runs", 'String'>
    readonly mode: FieldRef<"prompt_eval_runs", 'String'>
    readonly caseCount: FieldRef<"prompt_eval_runs", 'Int'>
    readonly totalRuns: FieldRef<"prompt_eval_runs", 'Int'>
    readonly summaryJson: FieldRef<"prompt_eval_runs", 'String'>
    readonly resultsJson: FieldRef<"prompt_eval_runs", 'String'>
    readonly durationMs: FieldRef<"prompt_eval_runs", 'Int'>
    readonly triggeredBy: FieldRef<"prompt_eval_runs", 'String'>
    readonly createdAt: FieldRef<"prompt_eval_runs", 'DateTime'>
  }
    

  // Custom InputTypes
  /**
   * prompt_eval_runs findUnique
   */
  export type prompt_eval_runsFindUniqueArgs<ExtArgs extends $Extensions.InternalArgs = $Extensions.DefaultArgs> = {
    /**
     * Select specific fields to fetch from the prompt_eval_runs
     */
    select?: prompt_eval_runsSelect<ExtArgs> | null
    /**
     * Filter, which prompt_eval_runs to fetch.
     */
    where: prompt_eval_runsWhereUniqueInput
  }

  /**
   * prompt_eval_runs findUniqueOrThrow
   */
  export type prompt_eval_runsFindUniqueOrThrowArgs<ExtArgs extends $Extensions.InternalArgs = $Extensions.DefaultArgs> = {
    /**
     * Select specific fields to fetch from the prompt_eval_runs
     */
    select?: prompt_eval_runsSelect<ExtArgs> | null
    /**
     * Filter, which prompt_eval_runs to fetch.
     */
    where: prompt_eval_runsWhereUniqueInput
  }

  /**
   * prompt_eval_runs findFirst
   */
  export type prompt_eval_runsFindFirstArgs<ExtArgs extends $Extensions.InternalArgs = $Extensions.DefaultArgs> = {
    /**
     * Select specific fields to fetch from the prompt_eval_runs
     */
    select?: prompt_eval_runsSelect<ExtArgs> | null
    /**
     * Filter, which prompt_eval_runs to fetch.
     */
    where?: prompt_eval_runsWhereInput
    /**
     * {@link https://www.prisma.io/docs/concepts/components/prisma-client/sorting Sorting Docs}
     * 
     * Determine the order of prompt_eval_runs to fetch.
     */
    orderBy?: prompt_eval_runsOrderByWithRelationInput | prompt_eval_runsOrderByWithRelationInput[]
    /**
     * {@link https://www.prisma.io/docs/concepts/components/prisma-client/pagination#cursor-based-pagination Cursor Docs}
     * 
     * Sets the position for searching for prompt_eval_runs.
     */
    cursor?: prompt_eval_runsWhereUniqueInput
    /**
     * {@link https://www.prisma.io/docs/concepts/components/prisma-client/pagination Pagination Docs}
     * 
     * Take `±n` prompt_eval_runs from the position of the cursor.
     */
    take?: number
    /**
     * {@link https://www.prisma.io/docs/concepts/components/prisma-client/pagination Pagination Docs}
     * 
     * Skip the first `n` prompt_eval_runs.
     */
    skip?: number
    /**
     * {@link https://www.prisma.io/docs/concepts/components/prisma-client/distinct Distinct Docs}
     * 
     * Filter by unique combinations of prompt_eval_runs.
     */
    distinct?: Prompt_eval_runsScalarFieldEnum | Prompt_eval_runsScalarFieldEnum[]
  }

  /**
   * prompt_eval_runs findFirstOrThrow
   */
  export type prompt_eval_runsFindFirstOrThrowArgs<ExtArgs extends $Extensions.InternalArgs = $Extensions.DefaultArgs> = {
    /**
     * Select specific fields to fetch from the prompt_eval_runs
     */
    select?: prompt_eval_runsSelect<ExtArgs> | null
    /**
     * Filter, which prompt_eval_runs to fetch.
     */
    where?: prompt_eval_runsWhereInput
    /**
     * {@link https://www.prisma.io/docs/concepts/components/prisma-client/sorting Sorting Docs}
     * 
     * Determine the order of prompt_eval_runs to fetch.
     */
    orderBy?: prompt_eval_runsOrderByWithRelationInput | prompt_eval_runsOrderByWithRelationInput[]
    /**
     * {@link https://www.prisma.io/docs/concepts/components/prisma-client/pagination#cursor-based-pagination Cursor Docs}
     * 
     * Sets the position for searching for prompt_eval_runs.
     */
    cursor?: prompt_eval_runsWhereUniqueInput
    /**
     * {@link https://www.prisma.io/docs/concepts/components/prisma-client/pagination Pagination Docs}
     * 
     * Take `±n` prompt_eval_runs from the position of the cursor.
     */
    take?: number
    /**
     * {@link https://www.prisma.io/docs/concepts/components/prisma-client/pagination Pagination Docs}
     * 
     * Skip the first `n` prompt_eval_runs.
     */
    skip?: number
    /**
     * {@link https://www.prisma.io/docs/concepts/components/prisma-client/distinct Distinct Docs}
     * 
     * Filter by unique combinations of prompt_eval_runs.
     */
    distinct?: Prompt_eval_runsScalarFieldEnum | Prompt_eval_runsScalarFieldEnum[]
  }

  /**
   * prompt_eval_runs findMany
   */
  export type prompt_eval_runsFindManyArgs<ExtArgs extends $Extensions.InternalArgs = $Extensions.DefaultArgs> = {
    /**
     * Select specific fields to fetch from the prompt_eval_runs
     */
    select?: prompt_eval_runsSelect<ExtArgs> | null
    /**
     * Filter, which prompt_eval_runs to fetch.
     */
    where?: prompt_eval_runsWhereInput
    /**
     * {@link https://www.prisma.io/docs/concepts/components/prisma-client/sorting Sorting Docs}
     * 
     * Determine the order of prompt_eval_runs to fetch.
     */
    orderBy?: prompt_eval_runsOrderByWithRelationInput | prompt_eval_runsOrderByWithRelationInput[]
    /**
     * {@link https://www.prisma.io/docs/concepts/components/prisma-client/pagination#cursor-based-pagination Cursor Docs}
     * 
     * Sets the position for listing prompt_eval_runs.
     */
    cursor?: prompt_eval_runsWhereUniqueInput
    /**
     * {@link https://www.prisma.io/docs/concepts/components/prisma-client/pagination Pagination Docs}
     * 
     * Take `±n` prompt_eval_runs from the position of the cursor.
     */
    take?: number
    /**
     * {@link https://www.prisma.io/docs/concepts/components/prisma-client/pagination Pagination Docs}
     * 
     * Skip the first `n` prompt_eval_runs.
     */
    skip?: number
    distinct?: Prompt_eval_runsScalarFieldEnum | Prompt_eval_runsScalarFieldEnum[]
  }

  /**
   * prompt_eval_runs create
   */
  export type prompt_eval_runsCreateArgs<ExtArgs extends $Extensions.InternalArgs = $Extensions.DefaultArgs> = {
    /**
     * Select specific fields to fetch from the prompt_eval_runs
     */
    select?: prompt_eval_runsSelect<ExtArgs> | null
    /**
     * The data needed to create a prompt_eval_runs.
     */
    data: XOR<prompt_eval_runsCreateInput, prompt_eval_runsUncheckedCreateInput>
  }

  /**
   * prompt_eval_runs createMany
   */
  export type prompt_eval_runsCreateManyArgs<ExtArgs extends $Extensions.InternalArgs = $Extensions.DefaultArgs> = {
    /**
     * The data used to create many prompt_eval_runs.
     */
    data: prompt_eval_runsCreateManyInput | prompt_eval_runsCreateManyInput[]
  }

  /**
   * prompt_eval_runs createManyAndReturn
   */
  export type prompt_eval_runsCreateManyAndReturnArgs<ExtArgs extends $Extensions.InternalArgs = $Extensions.DefaultArgs> = {
    /**
     * Select specific fields to fetch from the prompt_eval_runs
     */
    select?: prompt_eval_runsSelectCreateManyAndReturn<ExtArgs> | null
    /**
     * The data used to create many prompt_eval_runs.
     */
    data: prompt_eval_runsCreateManyInput | prompt_eval_runsCreateManyInput[]
  }

  /**
   * prompt_eval_runs update
   */
  export type prompt_eval_runsUpdateArgs<ExtArgs extends $Extensions.InternalArgs = $Extensions.DefaultArgs> = {
    /**
     * Select specific fields to fetch from the prompt_eval_runs
     */
    select?: prompt_eval_runsSelect<ExtArgs> | null
    /**
     * The data needed to update a prompt_eval_runs.
     */
    data: XOR<prompt_eval_runsUpdateInput, prompt_eval_runsUncheckedUpdateInput>
    /**
     * Choose, which prompt_eval_runs to update.
     */
    where: prompt_eval_runsWhereUniqueInput
  }

  /**
   * prompt_eval_runs updateMany
   */
  export type prompt_eval_runsUpdateManyArgs<ExtArgs extends $Extensions.InternalArgs = $Extensions.DefaultArgs> = {
    /**
     * The data used to update prompt_eval_runs.
     */
    data: XOR<prompt_eval_runsUpdateManyMutationInput, prompt_eval_runsUncheckedUpdateManyInput>
    /**
     * Filter which prompt_eval_runs to update
     */
    where?: prompt_eval_runsWhereInput
  }

  /**
   * prompt_eval_runs upsert
   */
  export type prompt_eval_runsUpsertArgs<ExtArgs extends $Extensions.InternalArgs = $Extensions.DefaultArgs> = {
    /**
     * Select specific fields to fetch from the prompt_eval_runs
     */
    select?: prompt_eval_runsSelect<ExtArgs> | null
    /**
     * The filter to search for the prompt_eval_runs to update in case it exists.
     */
    where: prompt_eval_runsWhereUniqueInput
    /**
     * In case the prompt_eval_runs found by the `where` argument doesn't exist, create a new prompt_eval_runs with this data.
     */
    create: XOR<prompt_eval_runsCreateInput, prompt_eval_runsUncheckedCreateInput>
    /**
     * In case the prompt_eval_runs was found with the provided `where` argument, update it with this data.
     */
    update: XOR<prompt_eval_runsUpdateInput, prompt_eval_runsUncheckedUpdateInput>
  }

  /**
   * prompt_eval_runs delete
   */
  export type prompt_eval_runsDeleteArgs<ExtArgs extends $Extensions.InternalArgs = $Extensions.DefaultArgs> = {
    /**
     * Select specific fields to fetch from the prompt_eval_runs
     */
    select?: prompt_eval_runsSelect<ExtArgs> | null
    /**
     * Filter which prompt_eval_runs to delete.
     */
    where: prompt_eval_runsWhereUniqueInput
  }

  /**
   * prompt_eval_runs deleteMany
   */
  export type prompt_eval_runsDeleteManyArgs<ExtArgs extends $Extensions.InternalArgs = $Extensions.DefaultArgs> = {
    /**
     * Filter which prompt_eval_runs to delete
     */
    where?: prompt_eval_runsWhereInput
  }

  /**
   * prompt_eval_runs without action
   */
  export type prompt_eval_runsDefaultArgs<ExtArgs extends $Extensions.InternalArgs = $Extensions.DefaultArgs> = {
    /**
     * Select specific fields to fetch from the prompt_eval_runs
     */
    select?: prompt_eval_runsSelect<ExtArgs> | null
  }


  /**
   * Enums
   */

  export const TransactionIsolationLevel: {
    Serializable: 'Serializable'
  };

  export type TransactionIsolationLevel = (typeof TransactionIsolationLevel)[keyof typeof TransactionIsolationLevel]


  export const Agent_lab_configsScalarFieldEnum: {
    id: 'id',
    agentName: 'agentName',
    model: 'model',
    temperature: 'temperature',
    maxTokens: 'maxTokens',
    baseURL: 'baseURL',
    apiKey: 'apiKey',
    systemPrompt: 'systemPrompt',
    extraConfig: 'extraConfig',
    createdAt: 'createdAt',
    updatedAt: 'updatedAt'
  };

  export type Agent_lab_configsScalarFieldEnum = (typeof Agent_lab_configsScalarFieldEnum)[keyof typeof Agent_lab_configsScalarFieldEnum]


  export const Agent_model_configsScalarFieldEnum: {
    id: 'id',
    agentId: 'agentId',
    tier: 'tier',
    model: 'model',
    endpoint: 'endpoint',
    apiKey: 'apiKey',
    temperature: 'temperature',
    maxTokens: 'maxTokens',
    priority: 'priority',
    enabled: 'enabled',
    createdAt: 'createdAt',
    updatedAt: 'updatedAt',
    reasoningEffort: 'reasoningEffort',
    thinkingMode: 'thinkingMode'
  };

  export type Agent_model_configsScalarFieldEnum = (typeof Agent_model_configsScalarFieldEnum)[keyof typeof Agent_model_configsScalarFieldEnum]


  export const Agent_promptsScalarFieldEnum: {
    id: 'id',
    agentId: 'agentId',
    version: 'version',
    name: 'name',
    description: 'description',
    systemPrompt: 'systemPrompt',
    compiledSystemPrompt: 'compiledSystemPrompt',
    compileStatus: 'compileStatus',
    compileError: 'compileError',
    sourceHash: 'sourceHash',
    compileContextHash: 'compileContextHash',
    compiledAt: 'compiledAt',
    temperature: 'temperature',
    maxTokens: 'maxTokens',
    model: 'model',
    status: 'status',
    createdBy: 'createdBy',
    createdAt: 'createdAt',
    updatedAt: 'updatedAt',
    metadata: 'metadata',
    useCount: 'useCount',
    avgLatency: 'avgLatency',
    successRate: 'successRate',
    publishedAt: 'publishedAt'
  };

  export type Agent_promptsScalarFieldEnum = (typeof Agent_promptsScalarFieldEnum)[keyof typeof Agent_promptsScalarFieldEnum]


  export const Agent_definitionsScalarFieldEnum: {
    id: 'id',
    displayName: 'displayName',
    description: 'description',
    category: 'category',
    inputSchema: 'inputSchema',
    outputSchema: 'outputSchema',
    variableBindings: 'variableBindings',
    capabilities: 'capabilities',
    defaultMaxTokens: 'defaultMaxTokens',
    defaultTemperature: 'defaultTemperature',
    schemaVersion: 'schemaVersion',
    source: 'source',
    managedByCode: 'managedByCode',
    createdAt: 'createdAt',
    updatedAt: 'updatedAt'
  };

  export type Agent_definitionsScalarFieldEnum = (typeof Agent_definitionsScalarFieldEnum)[keyof typeof Agent_definitionsScalarFieldEnum]


  export const Orchestrator_definitionsScalarFieldEnum: {
    id: 'id',
    displayName: 'displayName',
    description: 'description',
    category: 'category',
    steps: 'steps',
    variableGraph: 'variableGraph',
    source: 'source',
    managedByCode: 'managedByCode',
    createdAt: 'createdAt',
    updatedAt: 'updatedAt'
  };

  export type Orchestrator_definitionsScalarFieldEnum = (typeof Orchestrator_definitionsScalarFieldEnum)[keyof typeof Orchestrator_definitionsScalarFieldEnum]


  export const Agent_registrationsScalarFieldEnum: {
    id: 'id',
    name: 'name',
    type: 'type',
    category: 'category',
    description: 'description',
    version: 'version',
    config: 'config',
    inputSchema: 'inputSchema',
    outputSchema: 'outputSchema',
    capabilities: 'capabilities',
    subscribes: 'subscribes',
    publishes: 'publishes',
    callCount: 'callCount',
    successRate: 'successRate',
    createdAt: 'createdAt',
    updatedAt: 'updatedAt',
    endpoint: 'endpoint'
  };

  export type Agent_registrationsScalarFieldEnum = (typeof Agent_registrationsScalarFieldEnum)[keyof typeof Agent_registrationsScalarFieldEnum]


  export const Platform_api_configsScalarFieldEnum: {
    id: 'id',
    apiUrl: 'apiUrl',
    apiKey: 'apiKey',
    availableModels: 'availableModels',
    defaultModel: 'defaultModel',
    defaultReasoningModel: 'defaultReasoningModel',
    defaultEvaluationModel: 'defaultEvaluationModel',
    connectionStatus: 'connectionStatus',
    lastCheckedAt: 'lastCheckedAt',
    createdAt: 'createdAt',
    updatedAt: 'updatedAt',
    defaultTemperature: 'defaultTemperature',
    defaultMaxTokens: 'defaultMaxTokens',
    reasoningEndpoint: 'reasoningEndpoint',
    lightEndpoint: 'lightEndpoint',
    chatModels: 'chatModels',
    reasoningModels: 'reasoningModels',
    lightModels: 'lightModels',
    adminAccessMode: 'adminAccessMode',
    adminAllowedIps: 'adminAllowedIps',
    allowPrivateNetwork: 'allowPrivateNetwork',
    privateNetworkHosts: 'privateNetworkHosts'
  };

  export type Platform_api_configsScalarFieldEnum = (typeof Platform_api_configsScalarFieldEnum)[keyof typeof Platform_api_configsScalarFieldEnum]


  export const Platform_settingsScalarFieldEnum: {
    key: 'key',
    value: 'value',
    createdAt: 'createdAt',
    updatedAt: 'updatedAt'
  };

  export type Platform_settingsScalarFieldEnum = (typeof Platform_settingsScalarFieldEnum)[keyof typeof Platform_settingsScalarFieldEnum]


  export const Skill_model_configsScalarFieldEnum: {
    id: 'id',
    skillId: 'skillId',
    tier: 'tier',
    model: 'model',
    thinkingMode: 'thinkingMode',
    reasoningEffort: 'reasoningEffort',
    endpoint: 'endpoint',
    apiKey: 'apiKey',
    temperature: 'temperature',
    maxTokens: 'maxTokens',
    requestTimeoutMs: 'requestTimeoutMs',
    enabled: 'enabled',
    createdAt: 'createdAt',
    updatedAt: 'updatedAt'
  };

  export type Skill_model_configsScalarFieldEnum = (typeof Skill_model_configsScalarFieldEnum)[keyof typeof Skill_model_configsScalarFieldEnum]


  export const Skill_registrationsScalarFieldEnum: {
    id: 'id',
    name: 'name',
    version: 'version',
    category: 'category',
    description: 'description',
    inputSchema: 'inputSchema',
    outputSchema: 'outputSchema',
    endpoint: 'endpoint',
    callCount: 'callCount',
    successRate: 'successRate',
    createdAt: 'createdAt',
    updatedAt: 'updatedAt'
  };

  export type Skill_registrationsScalarFieldEnum = (typeof Skill_registrationsScalarFieldEnum)[keyof typeof Skill_registrationsScalarFieldEnum]


  export const Field_definitionsScalarFieldEnum: {
    id: 'id',
    fieldId: 'fieldId',
    stage: 'stage',
    promptRole: 'promptRole',
    valueType: 'valueType',
    snakeName: 'snakeName',
    camelName: 'camelName',
    description: 'description',
    enumValues: 'enumValues',
    schemaVersion: 'schemaVersion',
    source: 'source',
    managedByCode: 'managedByCode',
    systemLocked: 'systemLocked',
    structureLocked: 'structureLocked',
    bindings: 'bindings',
    metadata: 'metadata',
    createdAt: 'createdAt',
    updatedAt: 'updatedAt'
  };

  export type Field_definitionsScalarFieldEnum = (typeof Field_definitionsScalarFieldEnum)[keyof typeof Field_definitionsScalarFieldEnum]


  export const Agent_contractsScalarFieldEnum: {
    id: 'id',
    agentId: 'agentId',
    stage: 'stage',
    displayName: 'displayName',
    description: 'description',
    schemaVersion: 'schemaVersion',
    source: 'source',
    managedByCode: 'managedByCode',
    metadata: 'metadata',
    createdAt: 'createdAt',
    updatedAt: 'updatedAt'
  };

  export type Agent_contractsScalarFieldEnum = (typeof Agent_contractsScalarFieldEnum)[keyof typeof Agent_contractsScalarFieldEnum]


  export const Agent_field_routingsScalarFieldEnum: {
    id: 'id',
    agentId: 'agentId',
    fieldId: 'fieldId',
    render: 'render',
    handoff: 'handoff',
    internalFlag: 'internalFlag',
    accumulate: 'accumulate',
    visibilityPreset: 'visibilityPreset',
    ordering: 'ordering',
    notes: 'notes',
    source: 'source',
    managedByCode: 'managedByCode',
    systemLocked: 'systemLocked',
    structureLocked: 'structureLocked',
    createdAt: 'createdAt',
    updatedAt: 'updatedAt'
  };

  export type Agent_field_routingsScalarFieldEnum = (typeof Agent_field_routingsScalarFieldEnum)[keyof typeof Agent_field_routingsScalarFieldEnum]


  export const Node_config_changesScalarFieldEnum: {
    id: 'id',
    changeType: 'changeType',
    targetTable: 'targetTable',
    targetId: 'targetId',
    agentId: 'agentId',
    fieldId: 'fieldId',
    before: 'before',
    after: 'after',
    actorId: 'actorId',
    actorRole: 'actorRole',
    reason: 'reason',
    createdAt: 'createdAt'
  };

  export type Node_config_changesScalarFieldEnum = (typeof Node_config_changesScalarFieldEnum)[keyof typeof Node_config_changesScalarFieldEnum]


  export const Prompt_eval_casesScalarFieldEnum: {
    id: 'id',
    agentId: 'agentId',
    caseId: 'caseId',
    name: 'name',
    description: 'description',
    messagesJson: 'messagesJson',
    previousStateJson: 'previousStateJson',
    expectationsJson: 'expectationsJson',
    enabled: 'enabled',
    createdBy: 'createdBy',
    createdAt: 'createdAt',
    updatedAt: 'updatedAt'
  };

  export type Prompt_eval_casesScalarFieldEnum = (typeof Prompt_eval_casesScalarFieldEnum)[keyof typeof Prompt_eval_casesScalarFieldEnum]


  export const Prompt_eval_runsScalarFieldEnum: {
    id: 'id',
    agentId: 'agentId',
    promptVersionId: 'promptVersionId',
    promptVersion: 'promptVersion',
    promptSource: 'promptSource',
    mode: 'mode',
    caseCount: 'caseCount',
    totalRuns: 'totalRuns',
    summaryJson: 'summaryJson',
    resultsJson: 'resultsJson',
    durationMs: 'durationMs',
    triggeredBy: 'triggeredBy',
    createdAt: 'createdAt'
  };

  export type Prompt_eval_runsScalarFieldEnum = (typeof Prompt_eval_runsScalarFieldEnum)[keyof typeof Prompt_eval_runsScalarFieldEnum]


  export const SortOrder: {
    asc: 'asc',
    desc: 'desc'
  };

  export type SortOrder = (typeof SortOrder)[keyof typeof SortOrder]


  export const NullsOrder: {
    first: 'first',
    last: 'last'
  };

  export type NullsOrder = (typeof NullsOrder)[keyof typeof NullsOrder]


  /**
   * Field references 
   */


  /**
   * Reference to a field of type 'String'
   */
  export type StringFieldRefInput<$PrismaModel> = FieldRefInputType<$PrismaModel, 'String'>
    


  /**
   * Reference to a field of type 'Float'
   */
  export type FloatFieldRefInput<$PrismaModel> = FieldRefInputType<$PrismaModel, 'Float'>
    


  /**
   * Reference to a field of type 'Int'
   */
  export type IntFieldRefInput<$PrismaModel> = FieldRefInputType<$PrismaModel, 'Int'>
    


  /**
   * Reference to a field of type 'DateTime'
   */
  export type DateTimeFieldRefInput<$PrismaModel> = FieldRefInputType<$PrismaModel, 'DateTime'>
    


  /**
   * Reference to a field of type 'Boolean'
   */
  export type BooleanFieldRefInput<$PrismaModel> = FieldRefInputType<$PrismaModel, 'Boolean'>
    
  /**
   * Deep Input Types
   */


  export type agent_lab_configsWhereInput = {
    AND?: agent_lab_configsWhereInput | agent_lab_configsWhereInput[]
    OR?: agent_lab_configsWhereInput[]
    NOT?: agent_lab_configsWhereInput | agent_lab_configsWhereInput[]
    id?: StringFilter<"agent_lab_configs"> | string
    agentName?: StringFilter<"agent_lab_configs"> | string
    model?: StringNullableFilter<"agent_lab_configs"> | string | null
    temperature?: FloatNullableFilter<"agent_lab_configs"> | number | null
    maxTokens?: IntNullableFilter<"agent_lab_configs"> | number | null
    baseURL?: StringNullableFilter<"agent_lab_configs"> | string | null
    apiKey?: StringNullableFilter<"agent_lab_configs"> | string | null
    systemPrompt?: StringNullableFilter<"agent_lab_configs"> | string | null
    extraConfig?: StringNullableFilter<"agent_lab_configs"> | string | null
    createdAt?: DateTimeFilter<"agent_lab_configs"> | Date | string
    updatedAt?: DateTimeFilter<"agent_lab_configs"> | Date | string
  }

  export type agent_lab_configsOrderByWithRelationInput = {
    id?: SortOrder
    agentName?: SortOrder
    model?: SortOrderInput | SortOrder
    temperature?: SortOrderInput | SortOrder
    maxTokens?: SortOrderInput | SortOrder
    baseURL?: SortOrderInput | SortOrder
    apiKey?: SortOrderInput | SortOrder
    systemPrompt?: SortOrderInput | SortOrder
    extraConfig?: SortOrderInput | SortOrder
    createdAt?: SortOrder
    updatedAt?: SortOrder
  }

  export type agent_lab_configsWhereUniqueInput = Prisma.AtLeast<{
    id?: string
    agentName?: string
    AND?: agent_lab_configsWhereInput | agent_lab_configsWhereInput[]
    OR?: agent_lab_configsWhereInput[]
    NOT?: agent_lab_configsWhereInput | agent_lab_configsWhereInput[]
    model?: StringNullableFilter<"agent_lab_configs"> | string | null
    temperature?: FloatNullableFilter<"agent_lab_configs"> | number | null
    maxTokens?: IntNullableFilter<"agent_lab_configs"> | number | null
    baseURL?: StringNullableFilter<"agent_lab_configs"> | string | null
    apiKey?: StringNullableFilter<"agent_lab_configs"> | string | null
    systemPrompt?: StringNullableFilter<"agent_lab_configs"> | string | null
    extraConfig?: StringNullableFilter<"agent_lab_configs"> | string | null
    createdAt?: DateTimeFilter<"agent_lab_configs"> | Date | string
    updatedAt?: DateTimeFilter<"agent_lab_configs"> | Date | string
  }, "id" | "agentName">

  export type agent_lab_configsOrderByWithAggregationInput = {
    id?: SortOrder
    agentName?: SortOrder
    model?: SortOrderInput | SortOrder
    temperature?: SortOrderInput | SortOrder
    maxTokens?: SortOrderInput | SortOrder
    baseURL?: SortOrderInput | SortOrder
    apiKey?: SortOrderInput | SortOrder
    systemPrompt?: SortOrderInput | SortOrder
    extraConfig?: SortOrderInput | SortOrder
    createdAt?: SortOrder
    updatedAt?: SortOrder
    _count?: agent_lab_configsCountOrderByAggregateInput
    _avg?: agent_lab_configsAvgOrderByAggregateInput
    _max?: agent_lab_configsMaxOrderByAggregateInput
    _min?: agent_lab_configsMinOrderByAggregateInput
    _sum?: agent_lab_configsSumOrderByAggregateInput
  }

  export type agent_lab_configsScalarWhereWithAggregatesInput = {
    AND?: agent_lab_configsScalarWhereWithAggregatesInput | agent_lab_configsScalarWhereWithAggregatesInput[]
    OR?: agent_lab_configsScalarWhereWithAggregatesInput[]
    NOT?: agent_lab_configsScalarWhereWithAggregatesInput | agent_lab_configsScalarWhereWithAggregatesInput[]
    id?: StringWithAggregatesFilter<"agent_lab_configs"> | string
    agentName?: StringWithAggregatesFilter<"agent_lab_configs"> | string
    model?: StringNullableWithAggregatesFilter<"agent_lab_configs"> | string | null
    temperature?: FloatNullableWithAggregatesFilter<"agent_lab_configs"> | number | null
    maxTokens?: IntNullableWithAggregatesFilter<"agent_lab_configs"> | number | null
    baseURL?: StringNullableWithAggregatesFilter<"agent_lab_configs"> | string | null
    apiKey?: StringNullableWithAggregatesFilter<"agent_lab_configs"> | string | null
    systemPrompt?: StringNullableWithAggregatesFilter<"agent_lab_configs"> | string | null
    extraConfig?: StringNullableWithAggregatesFilter<"agent_lab_configs"> | string | null
    createdAt?: DateTimeWithAggregatesFilter<"agent_lab_configs"> | Date | string
    updatedAt?: DateTimeWithAggregatesFilter<"agent_lab_configs"> | Date | string
  }

  export type agent_model_configsWhereInput = {
    AND?: agent_model_configsWhereInput | agent_model_configsWhereInput[]
    OR?: agent_model_configsWhereInput[]
    NOT?: agent_model_configsWhereInput | agent_model_configsWhereInput[]
    id?: StringFilter<"agent_model_configs"> | string
    agentId?: StringFilter<"agent_model_configs"> | string
    tier?: StringFilter<"agent_model_configs"> | string
    model?: StringNullableFilter<"agent_model_configs"> | string | null
    endpoint?: StringNullableFilter<"agent_model_configs"> | string | null
    apiKey?: StringNullableFilter<"agent_model_configs"> | string | null
    temperature?: FloatFilter<"agent_model_configs"> | number
    maxTokens?: IntFilter<"agent_model_configs"> | number
    priority?: IntFilter<"agent_model_configs"> | number
    enabled?: BoolFilter<"agent_model_configs"> | boolean
    createdAt?: DateTimeFilter<"agent_model_configs"> | Date | string
    updatedAt?: DateTimeFilter<"agent_model_configs"> | Date | string
    reasoningEffort?: StringNullableFilter<"agent_model_configs"> | string | null
    thinkingMode?: StringNullableFilter<"agent_model_configs"> | string | null
  }

  export type agent_model_configsOrderByWithRelationInput = {
    id?: SortOrder
    agentId?: SortOrder
    tier?: SortOrder
    model?: SortOrderInput | SortOrder
    endpoint?: SortOrderInput | SortOrder
    apiKey?: SortOrderInput | SortOrder
    temperature?: SortOrder
    maxTokens?: SortOrder
    priority?: SortOrder
    enabled?: SortOrder
    createdAt?: SortOrder
    updatedAt?: SortOrder
    reasoningEffort?: SortOrderInput | SortOrder
    thinkingMode?: SortOrderInput | SortOrder
  }

  export type agent_model_configsWhereUniqueInput = Prisma.AtLeast<{
    id?: string
    agentId?: string
    AND?: agent_model_configsWhereInput | agent_model_configsWhereInput[]
    OR?: agent_model_configsWhereInput[]
    NOT?: agent_model_configsWhereInput | agent_model_configsWhereInput[]
    tier?: StringFilter<"agent_model_configs"> | string
    model?: StringNullableFilter<"agent_model_configs"> | string | null
    endpoint?: StringNullableFilter<"agent_model_configs"> | string | null
    apiKey?: StringNullableFilter<"agent_model_configs"> | string | null
    temperature?: FloatFilter<"agent_model_configs"> | number
    maxTokens?: IntFilter<"agent_model_configs"> | number
    priority?: IntFilter<"agent_model_configs"> | number
    enabled?: BoolFilter<"agent_model_configs"> | boolean
    createdAt?: DateTimeFilter<"agent_model_configs"> | Date | string
    updatedAt?: DateTimeFilter<"agent_model_configs"> | Date | string
    reasoningEffort?: StringNullableFilter<"agent_model_configs"> | string | null
    thinkingMode?: StringNullableFilter<"agent_model_configs"> | string | null
  }, "id" | "agentId">

  export type agent_model_configsOrderByWithAggregationInput = {
    id?: SortOrder
    agentId?: SortOrder
    tier?: SortOrder
    model?: SortOrderInput | SortOrder
    endpoint?: SortOrderInput | SortOrder
    apiKey?: SortOrderInput | SortOrder
    temperature?: SortOrder
    maxTokens?: SortOrder
    priority?: SortOrder
    enabled?: SortOrder
    createdAt?: SortOrder
    updatedAt?: SortOrder
    reasoningEffort?: SortOrderInput | SortOrder
    thinkingMode?: SortOrderInput | SortOrder
    _count?: agent_model_configsCountOrderByAggregateInput
    _avg?: agent_model_configsAvgOrderByAggregateInput
    _max?: agent_model_configsMaxOrderByAggregateInput
    _min?: agent_model_configsMinOrderByAggregateInput
    _sum?: agent_model_configsSumOrderByAggregateInput
  }

  export type agent_model_configsScalarWhereWithAggregatesInput = {
    AND?: agent_model_configsScalarWhereWithAggregatesInput | agent_model_configsScalarWhereWithAggregatesInput[]
    OR?: agent_model_configsScalarWhereWithAggregatesInput[]
    NOT?: agent_model_configsScalarWhereWithAggregatesInput | agent_model_configsScalarWhereWithAggregatesInput[]
    id?: StringWithAggregatesFilter<"agent_model_configs"> | string
    agentId?: StringWithAggregatesFilter<"agent_model_configs"> | string
    tier?: StringWithAggregatesFilter<"agent_model_configs"> | string
    model?: StringNullableWithAggregatesFilter<"agent_model_configs"> | string | null
    endpoint?: StringNullableWithAggregatesFilter<"agent_model_configs"> | string | null
    apiKey?: StringNullableWithAggregatesFilter<"agent_model_configs"> | string | null
    temperature?: FloatWithAggregatesFilter<"agent_model_configs"> | number
    maxTokens?: IntWithAggregatesFilter<"agent_model_configs"> | number
    priority?: IntWithAggregatesFilter<"agent_model_configs"> | number
    enabled?: BoolWithAggregatesFilter<"agent_model_configs"> | boolean
    createdAt?: DateTimeWithAggregatesFilter<"agent_model_configs"> | Date | string
    updatedAt?: DateTimeWithAggregatesFilter<"agent_model_configs"> | Date | string
    reasoningEffort?: StringNullableWithAggregatesFilter<"agent_model_configs"> | string | null
    thinkingMode?: StringNullableWithAggregatesFilter<"agent_model_configs"> | string | null
  }

  export type agent_promptsWhereInput = {
    AND?: agent_promptsWhereInput | agent_promptsWhereInput[]
    OR?: agent_promptsWhereInput[]
    NOT?: agent_promptsWhereInput | agent_promptsWhereInput[]
    id?: StringFilter<"agent_prompts"> | string
    agentId?: StringFilter<"agent_prompts"> | string
    version?: IntFilter<"agent_prompts"> | number
    name?: StringFilter<"agent_prompts"> | string
    description?: StringNullableFilter<"agent_prompts"> | string | null
    systemPrompt?: StringFilter<"agent_prompts"> | string
    compiledSystemPrompt?: StringNullableFilter<"agent_prompts"> | string | null
    compileStatus?: StringNullableFilter<"agent_prompts"> | string | null
    compileError?: StringNullableFilter<"agent_prompts"> | string | null
    sourceHash?: StringNullableFilter<"agent_prompts"> | string | null
    compileContextHash?: StringNullableFilter<"agent_prompts"> | string | null
    compiledAt?: DateTimeNullableFilter<"agent_prompts"> | Date | string | null
    temperature?: FloatNullableFilter<"agent_prompts"> | number | null
    maxTokens?: IntNullableFilter<"agent_prompts"> | number | null
    model?: StringNullableFilter<"agent_prompts"> | string | null
    status?: StringFilter<"agent_prompts"> | string
    createdBy?: StringFilter<"agent_prompts"> | string
    createdAt?: DateTimeFilter<"agent_prompts"> | Date | string
    updatedAt?: DateTimeFilter<"agent_prompts"> | Date | string
    metadata?: StringNullableFilter<"agent_prompts"> | string | null
    useCount?: IntFilter<"agent_prompts"> | number
    avgLatency?: FloatNullableFilter<"agent_prompts"> | number | null
    successRate?: FloatNullableFilter<"agent_prompts"> | number | null
    publishedAt?: DateTimeNullableFilter<"agent_prompts"> | Date | string | null
  }

  export type agent_promptsOrderByWithRelationInput = {
    id?: SortOrder
    agentId?: SortOrder
    version?: SortOrder
    name?: SortOrder
    description?: SortOrderInput | SortOrder
    systemPrompt?: SortOrder
    compiledSystemPrompt?: SortOrderInput | SortOrder
    compileStatus?: SortOrderInput | SortOrder
    compileError?: SortOrderInput | SortOrder
    sourceHash?: SortOrderInput | SortOrder
    compileContextHash?: SortOrderInput | SortOrder
    compiledAt?: SortOrderInput | SortOrder
    temperature?: SortOrderInput | SortOrder
    maxTokens?: SortOrderInput | SortOrder
    model?: SortOrderInput | SortOrder
    status?: SortOrder
    createdBy?: SortOrder
    createdAt?: SortOrder
    updatedAt?: SortOrder
    metadata?: SortOrderInput | SortOrder
    useCount?: SortOrder
    avgLatency?: SortOrderInput | SortOrder
    successRate?: SortOrderInput | SortOrder
    publishedAt?: SortOrderInput | SortOrder
  }

  export type agent_promptsWhereUniqueInput = Prisma.AtLeast<{
    id?: string
    agentId_version?: agent_promptsAgentIdVersionCompoundUniqueInput
    AND?: agent_promptsWhereInput | agent_promptsWhereInput[]
    OR?: agent_promptsWhereInput[]
    NOT?: agent_promptsWhereInput | agent_promptsWhereInput[]
    agentId?: StringFilter<"agent_prompts"> | string
    version?: IntFilter<"agent_prompts"> | number
    name?: StringFilter<"agent_prompts"> | string
    description?: StringNullableFilter<"agent_prompts"> | string | null
    systemPrompt?: StringFilter<"agent_prompts"> | string
    compiledSystemPrompt?: StringNullableFilter<"agent_prompts"> | string | null
    compileStatus?: StringNullableFilter<"agent_prompts"> | string | null
    compileError?: StringNullableFilter<"agent_prompts"> | string | null
    sourceHash?: StringNullableFilter<"agent_prompts"> | string | null
    compileContextHash?: StringNullableFilter<"agent_prompts"> | string | null
    compiledAt?: DateTimeNullableFilter<"agent_prompts"> | Date | string | null
    temperature?: FloatNullableFilter<"agent_prompts"> | number | null
    maxTokens?: IntNullableFilter<"agent_prompts"> | number | null
    model?: StringNullableFilter<"agent_prompts"> | string | null
    status?: StringFilter<"agent_prompts"> | string
    createdBy?: StringFilter<"agent_prompts"> | string
    createdAt?: DateTimeFilter<"agent_prompts"> | Date | string
    updatedAt?: DateTimeFilter<"agent_prompts"> | Date | string
    metadata?: StringNullableFilter<"agent_prompts"> | string | null
    useCount?: IntFilter<"agent_prompts"> | number
    avgLatency?: FloatNullableFilter<"agent_prompts"> | number | null
    successRate?: FloatNullableFilter<"agent_prompts"> | number | null
    publishedAt?: DateTimeNullableFilter<"agent_prompts"> | Date | string | null
  }, "id" | "agentId_version">

  export type agent_promptsOrderByWithAggregationInput = {
    id?: SortOrder
    agentId?: SortOrder
    version?: SortOrder
    name?: SortOrder
    description?: SortOrderInput | SortOrder
    systemPrompt?: SortOrder
    compiledSystemPrompt?: SortOrderInput | SortOrder
    compileStatus?: SortOrderInput | SortOrder
    compileError?: SortOrderInput | SortOrder
    sourceHash?: SortOrderInput | SortOrder
    compileContextHash?: SortOrderInput | SortOrder
    compiledAt?: SortOrderInput | SortOrder
    temperature?: SortOrderInput | SortOrder
    maxTokens?: SortOrderInput | SortOrder
    model?: SortOrderInput | SortOrder
    status?: SortOrder
    createdBy?: SortOrder
    createdAt?: SortOrder
    updatedAt?: SortOrder
    metadata?: SortOrderInput | SortOrder
    useCount?: SortOrder
    avgLatency?: SortOrderInput | SortOrder
    successRate?: SortOrderInput | SortOrder
    publishedAt?: SortOrderInput | SortOrder
    _count?: agent_promptsCountOrderByAggregateInput
    _avg?: agent_promptsAvgOrderByAggregateInput
    _max?: agent_promptsMaxOrderByAggregateInput
    _min?: agent_promptsMinOrderByAggregateInput
    _sum?: agent_promptsSumOrderByAggregateInput
  }

  export type agent_promptsScalarWhereWithAggregatesInput = {
    AND?: agent_promptsScalarWhereWithAggregatesInput | agent_promptsScalarWhereWithAggregatesInput[]
    OR?: agent_promptsScalarWhereWithAggregatesInput[]
    NOT?: agent_promptsScalarWhereWithAggregatesInput | agent_promptsScalarWhereWithAggregatesInput[]
    id?: StringWithAggregatesFilter<"agent_prompts"> | string
    agentId?: StringWithAggregatesFilter<"agent_prompts"> | string
    version?: IntWithAggregatesFilter<"agent_prompts"> | number
    name?: StringWithAggregatesFilter<"agent_prompts"> | string
    description?: StringNullableWithAggregatesFilter<"agent_prompts"> | string | null
    systemPrompt?: StringWithAggregatesFilter<"agent_prompts"> | string
    compiledSystemPrompt?: StringNullableWithAggregatesFilter<"agent_prompts"> | string | null
    compileStatus?: StringNullableWithAggregatesFilter<"agent_prompts"> | string | null
    compileError?: StringNullableWithAggregatesFilter<"agent_prompts"> | string | null
    sourceHash?: StringNullableWithAggregatesFilter<"agent_prompts"> | string | null
    compileContextHash?: StringNullableWithAggregatesFilter<"agent_prompts"> | string | null
    compiledAt?: DateTimeNullableWithAggregatesFilter<"agent_prompts"> | Date | string | null
    temperature?: FloatNullableWithAggregatesFilter<"agent_prompts"> | number | null
    maxTokens?: IntNullableWithAggregatesFilter<"agent_prompts"> | number | null
    model?: StringNullableWithAggregatesFilter<"agent_prompts"> | string | null
    status?: StringWithAggregatesFilter<"agent_prompts"> | string
    createdBy?: StringWithAggregatesFilter<"agent_prompts"> | string
    createdAt?: DateTimeWithAggregatesFilter<"agent_prompts"> | Date | string
    updatedAt?: DateTimeWithAggregatesFilter<"agent_prompts"> | Date | string
    metadata?: StringNullableWithAggregatesFilter<"agent_prompts"> | string | null
    useCount?: IntWithAggregatesFilter<"agent_prompts"> | number
    avgLatency?: FloatNullableWithAggregatesFilter<"agent_prompts"> | number | null
    successRate?: FloatNullableWithAggregatesFilter<"agent_prompts"> | number | null
    publishedAt?: DateTimeNullableWithAggregatesFilter<"agent_prompts"> | Date | string | null
  }

  export type agent_definitionsWhereInput = {
    AND?: agent_definitionsWhereInput | agent_definitionsWhereInput[]
    OR?: agent_definitionsWhereInput[]
    NOT?: agent_definitionsWhereInput | agent_definitionsWhereInput[]
    id?: StringFilter<"agent_definitions"> | string
    displayName?: StringFilter<"agent_definitions"> | string
    description?: StringNullableFilter<"agent_definitions"> | string | null
    category?: StringFilter<"agent_definitions"> | string
    inputSchema?: StringNullableFilter<"agent_definitions"> | string | null
    outputSchema?: StringNullableFilter<"agent_definitions"> | string | null
    variableBindings?: StringNullableFilter<"agent_definitions"> | string | null
    capabilities?: StringNullableFilter<"agent_definitions"> | string | null
    defaultMaxTokens?: IntNullableFilter<"agent_definitions"> | number | null
    defaultTemperature?: FloatNullableFilter<"agent_definitions"> | number | null
    schemaVersion?: IntFilter<"agent_definitions"> | number
    source?: StringFilter<"agent_definitions"> | string
    managedByCode?: BoolFilter<"agent_definitions"> | boolean
    createdAt?: DateTimeFilter<"agent_definitions"> | Date | string
    updatedAt?: DateTimeFilter<"agent_definitions"> | Date | string
  }

  export type agent_definitionsOrderByWithRelationInput = {
    id?: SortOrder
    displayName?: SortOrder
    description?: SortOrderInput | SortOrder
    category?: SortOrder
    inputSchema?: SortOrderInput | SortOrder
    outputSchema?: SortOrderInput | SortOrder
    variableBindings?: SortOrderInput | SortOrder
    capabilities?: SortOrderInput | SortOrder
    defaultMaxTokens?: SortOrderInput | SortOrder
    defaultTemperature?: SortOrderInput | SortOrder
    schemaVersion?: SortOrder
    source?: SortOrder
    managedByCode?: SortOrder
    createdAt?: SortOrder
    updatedAt?: SortOrder
  }

  export type agent_definitionsWhereUniqueInput = Prisma.AtLeast<{
    id?: string
    AND?: agent_definitionsWhereInput | agent_definitionsWhereInput[]
    OR?: agent_definitionsWhereInput[]
    NOT?: agent_definitionsWhereInput | agent_definitionsWhereInput[]
    displayName?: StringFilter<"agent_definitions"> | string
    description?: StringNullableFilter<"agent_definitions"> | string | null
    category?: StringFilter<"agent_definitions"> | string
    inputSchema?: StringNullableFilter<"agent_definitions"> | string | null
    outputSchema?: StringNullableFilter<"agent_definitions"> | string | null
    variableBindings?: StringNullableFilter<"agent_definitions"> | string | null
    capabilities?: StringNullableFilter<"agent_definitions"> | string | null
    defaultMaxTokens?: IntNullableFilter<"agent_definitions"> | number | null
    defaultTemperature?: FloatNullableFilter<"agent_definitions"> | number | null
    schemaVersion?: IntFilter<"agent_definitions"> | number
    source?: StringFilter<"agent_definitions"> | string
    managedByCode?: BoolFilter<"agent_definitions"> | boolean
    createdAt?: DateTimeFilter<"agent_definitions"> | Date | string
    updatedAt?: DateTimeFilter<"agent_definitions"> | Date | string
  }, "id">

  export type agent_definitionsOrderByWithAggregationInput = {
    id?: SortOrder
    displayName?: SortOrder
    description?: SortOrderInput | SortOrder
    category?: SortOrder
    inputSchema?: SortOrderInput | SortOrder
    outputSchema?: SortOrderInput | SortOrder
    variableBindings?: SortOrderInput | SortOrder
    capabilities?: SortOrderInput | SortOrder
    defaultMaxTokens?: SortOrderInput | SortOrder
    defaultTemperature?: SortOrderInput | SortOrder
    schemaVersion?: SortOrder
    source?: SortOrder
    managedByCode?: SortOrder
    createdAt?: SortOrder
    updatedAt?: SortOrder
    _count?: agent_definitionsCountOrderByAggregateInput
    _avg?: agent_definitionsAvgOrderByAggregateInput
    _max?: agent_definitionsMaxOrderByAggregateInput
    _min?: agent_definitionsMinOrderByAggregateInput
    _sum?: agent_definitionsSumOrderByAggregateInput
  }

  export type agent_definitionsScalarWhereWithAggregatesInput = {
    AND?: agent_definitionsScalarWhereWithAggregatesInput | agent_definitionsScalarWhereWithAggregatesInput[]
    OR?: agent_definitionsScalarWhereWithAggregatesInput[]
    NOT?: agent_definitionsScalarWhereWithAggregatesInput | agent_definitionsScalarWhereWithAggregatesInput[]
    id?: StringWithAggregatesFilter<"agent_definitions"> | string
    displayName?: StringWithAggregatesFilter<"agent_definitions"> | string
    description?: StringNullableWithAggregatesFilter<"agent_definitions"> | string | null
    category?: StringWithAggregatesFilter<"agent_definitions"> | string
    inputSchema?: StringNullableWithAggregatesFilter<"agent_definitions"> | string | null
    outputSchema?: StringNullableWithAggregatesFilter<"agent_definitions"> | string | null
    variableBindings?: StringNullableWithAggregatesFilter<"agent_definitions"> | string | null
    capabilities?: StringNullableWithAggregatesFilter<"agent_definitions"> | string | null
    defaultMaxTokens?: IntNullableWithAggregatesFilter<"agent_definitions"> | number | null
    defaultTemperature?: FloatNullableWithAggregatesFilter<"agent_definitions"> | number | null
    schemaVersion?: IntWithAggregatesFilter<"agent_definitions"> | number
    source?: StringWithAggregatesFilter<"agent_definitions"> | string
    managedByCode?: BoolWithAggregatesFilter<"agent_definitions"> | boolean
    createdAt?: DateTimeWithAggregatesFilter<"agent_definitions"> | Date | string
    updatedAt?: DateTimeWithAggregatesFilter<"agent_definitions"> | Date | string
  }

  export type orchestrator_definitionsWhereInput = {
    AND?: orchestrator_definitionsWhereInput | orchestrator_definitionsWhereInput[]
    OR?: orchestrator_definitionsWhereInput[]
    NOT?: orchestrator_definitionsWhereInput | orchestrator_definitionsWhereInput[]
    id?: StringFilter<"orchestrator_definitions"> | string
    displayName?: StringFilter<"orchestrator_definitions"> | string
    description?: StringNullableFilter<"orchestrator_definitions"> | string | null
    category?: StringFilter<"orchestrator_definitions"> | string
    steps?: StringFilter<"orchestrator_definitions"> | string
    variableGraph?: StringNullableFilter<"orchestrator_definitions"> | string | null
    source?: StringFilter<"orchestrator_definitions"> | string
    managedByCode?: BoolFilter<"orchestrator_definitions"> | boolean
    createdAt?: DateTimeFilter<"orchestrator_definitions"> | Date | string
    updatedAt?: DateTimeFilter<"orchestrator_definitions"> | Date | string
  }

  export type orchestrator_definitionsOrderByWithRelationInput = {
    id?: SortOrder
    displayName?: SortOrder
    description?: SortOrderInput | SortOrder
    category?: SortOrder
    steps?: SortOrder
    variableGraph?: SortOrderInput | SortOrder
    source?: SortOrder
    managedByCode?: SortOrder
    createdAt?: SortOrder
    updatedAt?: SortOrder
  }

  export type orchestrator_definitionsWhereUniqueInput = Prisma.AtLeast<{
    id?: string
    AND?: orchestrator_definitionsWhereInput | orchestrator_definitionsWhereInput[]
    OR?: orchestrator_definitionsWhereInput[]
    NOT?: orchestrator_definitionsWhereInput | orchestrator_definitionsWhereInput[]
    displayName?: StringFilter<"orchestrator_definitions"> | string
    description?: StringNullableFilter<"orchestrator_definitions"> | string | null
    category?: StringFilter<"orchestrator_definitions"> | string
    steps?: StringFilter<"orchestrator_definitions"> | string
    variableGraph?: StringNullableFilter<"orchestrator_definitions"> | string | null
    source?: StringFilter<"orchestrator_definitions"> | string
    managedByCode?: BoolFilter<"orchestrator_definitions"> | boolean
    createdAt?: DateTimeFilter<"orchestrator_definitions"> | Date | string
    updatedAt?: DateTimeFilter<"orchestrator_definitions"> | Date | string
  }, "id">

  export type orchestrator_definitionsOrderByWithAggregationInput = {
    id?: SortOrder
    displayName?: SortOrder
    description?: SortOrderInput | SortOrder
    category?: SortOrder
    steps?: SortOrder
    variableGraph?: SortOrderInput | SortOrder
    source?: SortOrder
    managedByCode?: SortOrder
    createdAt?: SortOrder
    updatedAt?: SortOrder
    _count?: orchestrator_definitionsCountOrderByAggregateInput
    _max?: orchestrator_definitionsMaxOrderByAggregateInput
    _min?: orchestrator_definitionsMinOrderByAggregateInput
  }

  export type orchestrator_definitionsScalarWhereWithAggregatesInput = {
    AND?: orchestrator_definitionsScalarWhereWithAggregatesInput | orchestrator_definitionsScalarWhereWithAggregatesInput[]
    OR?: orchestrator_definitionsScalarWhereWithAggregatesInput[]
    NOT?: orchestrator_definitionsScalarWhereWithAggregatesInput | orchestrator_definitionsScalarWhereWithAggregatesInput[]
    id?: StringWithAggregatesFilter<"orchestrator_definitions"> | string
    displayName?: StringWithAggregatesFilter<"orchestrator_definitions"> | string
    description?: StringNullableWithAggregatesFilter<"orchestrator_definitions"> | string | null
    category?: StringWithAggregatesFilter<"orchestrator_definitions"> | string
    steps?: StringWithAggregatesFilter<"orchestrator_definitions"> | string
    variableGraph?: StringNullableWithAggregatesFilter<"orchestrator_definitions"> | string | null
    source?: StringWithAggregatesFilter<"orchestrator_definitions"> | string
    managedByCode?: BoolWithAggregatesFilter<"orchestrator_definitions"> | boolean
    createdAt?: DateTimeWithAggregatesFilter<"orchestrator_definitions"> | Date | string
    updatedAt?: DateTimeWithAggregatesFilter<"orchestrator_definitions"> | Date | string
  }

  export type agent_registrationsWhereInput = {
    AND?: agent_registrationsWhereInput | agent_registrationsWhereInput[]
    OR?: agent_registrationsWhereInput[]
    NOT?: agent_registrationsWhereInput | agent_registrationsWhereInput[]
    id?: StringFilter<"agent_registrations"> | string
    name?: StringFilter<"agent_registrations"> | string
    type?: StringFilter<"agent_registrations"> | string
    category?: StringNullableFilter<"agent_registrations"> | string | null
    description?: StringNullableFilter<"agent_registrations"> | string | null
    version?: StringFilter<"agent_registrations"> | string
    config?: StringNullableFilter<"agent_registrations"> | string | null
    inputSchema?: StringNullableFilter<"agent_registrations"> | string | null
    outputSchema?: StringNullableFilter<"agent_registrations"> | string | null
    capabilities?: StringNullableFilter<"agent_registrations"> | string | null
    subscribes?: StringNullableFilter<"agent_registrations"> | string | null
    publishes?: StringNullableFilter<"agent_registrations"> | string | null
    callCount?: IntFilter<"agent_registrations"> | number
    successRate?: FloatFilter<"agent_registrations"> | number
    createdAt?: DateTimeFilter<"agent_registrations"> | Date | string
    updatedAt?: DateTimeFilter<"agent_registrations"> | Date | string
    endpoint?: StringNullableFilter<"agent_registrations"> | string | null
  }

  export type agent_registrationsOrderByWithRelationInput = {
    id?: SortOrder
    name?: SortOrder
    type?: SortOrder
    category?: SortOrderInput | SortOrder
    description?: SortOrderInput | SortOrder
    version?: SortOrder
    config?: SortOrderInput | SortOrder
    inputSchema?: SortOrderInput | SortOrder
    outputSchema?: SortOrderInput | SortOrder
    capabilities?: SortOrderInput | SortOrder
    subscribes?: SortOrderInput | SortOrder
    publishes?: SortOrderInput | SortOrder
    callCount?: SortOrder
    successRate?: SortOrder
    createdAt?: SortOrder
    updatedAt?: SortOrder
    endpoint?: SortOrderInput | SortOrder
  }

  export type agent_registrationsWhereUniqueInput = Prisma.AtLeast<{
    id?: string
    name?: string
    AND?: agent_registrationsWhereInput | agent_registrationsWhereInput[]
    OR?: agent_registrationsWhereInput[]
    NOT?: agent_registrationsWhereInput | agent_registrationsWhereInput[]
    type?: StringFilter<"agent_registrations"> | string
    category?: StringNullableFilter<"agent_registrations"> | string | null
    description?: StringNullableFilter<"agent_registrations"> | string | null
    version?: StringFilter<"agent_registrations"> | string
    config?: StringNullableFilter<"agent_registrations"> | string | null
    inputSchema?: StringNullableFilter<"agent_registrations"> | string | null
    outputSchema?: StringNullableFilter<"agent_registrations"> | string | null
    capabilities?: StringNullableFilter<"agent_registrations"> | string | null
    subscribes?: StringNullableFilter<"agent_registrations"> | string | null
    publishes?: StringNullableFilter<"agent_registrations"> | string | null
    callCount?: IntFilter<"agent_registrations"> | number
    successRate?: FloatFilter<"agent_registrations"> | number
    createdAt?: DateTimeFilter<"agent_registrations"> | Date | string
    updatedAt?: DateTimeFilter<"agent_registrations"> | Date | string
    endpoint?: StringNullableFilter<"agent_registrations"> | string | null
  }, "id" | "name">

  export type agent_registrationsOrderByWithAggregationInput = {
    id?: SortOrder
    name?: SortOrder
    type?: SortOrder
    category?: SortOrderInput | SortOrder
    description?: SortOrderInput | SortOrder
    version?: SortOrder
    config?: SortOrderInput | SortOrder
    inputSchema?: SortOrderInput | SortOrder
    outputSchema?: SortOrderInput | SortOrder
    capabilities?: SortOrderInput | SortOrder
    subscribes?: SortOrderInput | SortOrder
    publishes?: SortOrderInput | SortOrder
    callCount?: SortOrder
    successRate?: SortOrder
    createdAt?: SortOrder
    updatedAt?: SortOrder
    endpoint?: SortOrderInput | SortOrder
    _count?: agent_registrationsCountOrderByAggregateInput
    _avg?: agent_registrationsAvgOrderByAggregateInput
    _max?: agent_registrationsMaxOrderByAggregateInput
    _min?: agent_registrationsMinOrderByAggregateInput
    _sum?: agent_registrationsSumOrderByAggregateInput
  }

  export type agent_registrationsScalarWhereWithAggregatesInput = {
    AND?: agent_registrationsScalarWhereWithAggregatesInput | agent_registrationsScalarWhereWithAggregatesInput[]
    OR?: agent_registrationsScalarWhereWithAggregatesInput[]
    NOT?: agent_registrationsScalarWhereWithAggregatesInput | agent_registrationsScalarWhereWithAggregatesInput[]
    id?: StringWithAggregatesFilter<"agent_registrations"> | string
    name?: StringWithAggregatesFilter<"agent_registrations"> | string
    type?: StringWithAggregatesFilter<"agent_registrations"> | string
    category?: StringNullableWithAggregatesFilter<"agent_registrations"> | string | null
    description?: StringNullableWithAggregatesFilter<"agent_registrations"> | string | null
    version?: StringWithAggregatesFilter<"agent_registrations"> | string
    config?: StringNullableWithAggregatesFilter<"agent_registrations"> | string | null
    inputSchema?: StringNullableWithAggregatesFilter<"agent_registrations"> | string | null
    outputSchema?: StringNullableWithAggregatesFilter<"agent_registrations"> | string | null
    capabilities?: StringNullableWithAggregatesFilter<"agent_registrations"> | string | null
    subscribes?: StringNullableWithAggregatesFilter<"agent_registrations"> | string | null
    publishes?: StringNullableWithAggregatesFilter<"agent_registrations"> | string | null
    callCount?: IntWithAggregatesFilter<"agent_registrations"> | number
    successRate?: FloatWithAggregatesFilter<"agent_registrations"> | number
    createdAt?: DateTimeWithAggregatesFilter<"agent_registrations"> | Date | string
    updatedAt?: DateTimeWithAggregatesFilter<"agent_registrations"> | Date | string
    endpoint?: StringNullableWithAggregatesFilter<"agent_registrations"> | string | null
  }

  export type platform_api_configsWhereInput = {
    AND?: platform_api_configsWhereInput | platform_api_configsWhereInput[]
    OR?: platform_api_configsWhereInput[]
    NOT?: platform_api_configsWhereInput | platform_api_configsWhereInput[]
    id?: StringFilter<"platform_api_configs"> | string
    apiUrl?: StringNullableFilter<"platform_api_configs"> | string | null
    apiKey?: StringNullableFilter<"platform_api_configs"> | string | null
    availableModels?: StringNullableFilter<"platform_api_configs"> | string | null
    defaultModel?: StringNullableFilter<"platform_api_configs"> | string | null
    defaultReasoningModel?: StringNullableFilter<"platform_api_configs"> | string | null
    defaultEvaluationModel?: StringNullableFilter<"platform_api_configs"> | string | null
    connectionStatus?: StringFilter<"platform_api_configs"> | string
    lastCheckedAt?: DateTimeNullableFilter<"platform_api_configs"> | Date | string | null
    createdAt?: DateTimeFilter<"platform_api_configs"> | Date | string
    updatedAt?: DateTimeFilter<"platform_api_configs"> | Date | string
    defaultTemperature?: FloatFilter<"platform_api_configs"> | number
    defaultMaxTokens?: IntFilter<"platform_api_configs"> | number
    reasoningEndpoint?: StringNullableFilter<"platform_api_configs"> | string | null
    lightEndpoint?: StringNullableFilter<"platform_api_configs"> | string | null
    chatModels?: StringNullableFilter<"platform_api_configs"> | string | null
    reasoningModels?: StringNullableFilter<"platform_api_configs"> | string | null
    lightModels?: StringNullableFilter<"platform_api_configs"> | string | null
    adminAccessMode?: StringNullableFilter<"platform_api_configs"> | string | null
    adminAllowedIps?: StringNullableFilter<"platform_api_configs"> | string | null
    allowPrivateNetwork?: BoolNullableFilter<"platform_api_configs"> | boolean | null
    privateNetworkHosts?: StringNullableFilter<"platform_api_configs"> | string | null
  }

  export type platform_api_configsOrderByWithRelationInput = {
    id?: SortOrder
    apiUrl?: SortOrderInput | SortOrder
    apiKey?: SortOrderInput | SortOrder
    availableModels?: SortOrderInput | SortOrder
    defaultModel?: SortOrderInput | SortOrder
    defaultReasoningModel?: SortOrderInput | SortOrder
    defaultEvaluationModel?: SortOrderInput | SortOrder
    connectionStatus?: SortOrder
    lastCheckedAt?: SortOrderInput | SortOrder
    createdAt?: SortOrder
    updatedAt?: SortOrder
    defaultTemperature?: SortOrder
    defaultMaxTokens?: SortOrder
    reasoningEndpoint?: SortOrderInput | SortOrder
    lightEndpoint?: SortOrderInput | SortOrder
    chatModels?: SortOrderInput | SortOrder
    reasoningModels?: SortOrderInput | SortOrder
    lightModels?: SortOrderInput | SortOrder
    adminAccessMode?: SortOrderInput | SortOrder
    adminAllowedIps?: SortOrderInput | SortOrder
    allowPrivateNetwork?: SortOrderInput | SortOrder
    privateNetworkHosts?: SortOrderInput | SortOrder
  }

  export type platform_api_configsWhereUniqueInput = Prisma.AtLeast<{
    id?: string
    AND?: platform_api_configsWhereInput | platform_api_configsWhereInput[]
    OR?: platform_api_configsWhereInput[]
    NOT?: platform_api_configsWhereInput | platform_api_configsWhereInput[]
    apiUrl?: StringNullableFilter<"platform_api_configs"> | string | null
    apiKey?: StringNullableFilter<"platform_api_configs"> | string | null
    availableModels?: StringNullableFilter<"platform_api_configs"> | string | null
    defaultModel?: StringNullableFilter<"platform_api_configs"> | string | null
    defaultReasoningModel?: StringNullableFilter<"platform_api_configs"> | string | null
    defaultEvaluationModel?: StringNullableFilter<"platform_api_configs"> | string | null
    connectionStatus?: StringFilter<"platform_api_configs"> | string
    lastCheckedAt?: DateTimeNullableFilter<"platform_api_configs"> | Date | string | null
    createdAt?: DateTimeFilter<"platform_api_configs"> | Date | string
    updatedAt?: DateTimeFilter<"platform_api_configs"> | Date | string
    defaultTemperature?: FloatFilter<"platform_api_configs"> | number
    defaultMaxTokens?: IntFilter<"platform_api_configs"> | number
    reasoningEndpoint?: StringNullableFilter<"platform_api_configs"> | string | null
    lightEndpoint?: StringNullableFilter<"platform_api_configs"> | string | null
    chatModels?: StringNullableFilter<"platform_api_configs"> | string | null
    reasoningModels?: StringNullableFilter<"platform_api_configs"> | string | null
    lightModels?: StringNullableFilter<"platform_api_configs"> | string | null
    adminAccessMode?: StringNullableFilter<"platform_api_configs"> | string | null
    adminAllowedIps?: StringNullableFilter<"platform_api_configs"> | string | null
    allowPrivateNetwork?: BoolNullableFilter<"platform_api_configs"> | boolean | null
    privateNetworkHosts?: StringNullableFilter<"platform_api_configs"> | string | null
  }, "id">

  export type platform_api_configsOrderByWithAggregationInput = {
    id?: SortOrder
    apiUrl?: SortOrderInput | SortOrder
    apiKey?: SortOrderInput | SortOrder
    availableModels?: SortOrderInput | SortOrder
    defaultModel?: SortOrderInput | SortOrder
    defaultReasoningModel?: SortOrderInput | SortOrder
    defaultEvaluationModel?: SortOrderInput | SortOrder
    connectionStatus?: SortOrder
    lastCheckedAt?: SortOrderInput | SortOrder
    createdAt?: SortOrder
    updatedAt?: SortOrder
    defaultTemperature?: SortOrder
    defaultMaxTokens?: SortOrder
    reasoningEndpoint?: SortOrderInput | SortOrder
    lightEndpoint?: SortOrderInput | SortOrder
    chatModels?: SortOrderInput | SortOrder
    reasoningModels?: SortOrderInput | SortOrder
    lightModels?: SortOrderInput | SortOrder
    adminAccessMode?: SortOrderInput | SortOrder
    adminAllowedIps?: SortOrderInput | SortOrder
    allowPrivateNetwork?: SortOrderInput | SortOrder
    privateNetworkHosts?: SortOrderInput | SortOrder
    _count?: platform_api_configsCountOrderByAggregateInput
    _avg?: platform_api_configsAvgOrderByAggregateInput
    _max?: platform_api_configsMaxOrderByAggregateInput
    _min?: platform_api_configsMinOrderByAggregateInput
    _sum?: platform_api_configsSumOrderByAggregateInput
  }

  export type platform_api_configsScalarWhereWithAggregatesInput = {
    AND?: platform_api_configsScalarWhereWithAggregatesInput | platform_api_configsScalarWhereWithAggregatesInput[]
    OR?: platform_api_configsScalarWhereWithAggregatesInput[]
    NOT?: platform_api_configsScalarWhereWithAggregatesInput | platform_api_configsScalarWhereWithAggregatesInput[]
    id?: StringWithAggregatesFilter<"platform_api_configs"> | string
    apiUrl?: StringNullableWithAggregatesFilter<"platform_api_configs"> | string | null
    apiKey?: StringNullableWithAggregatesFilter<"platform_api_configs"> | string | null
    availableModels?: StringNullableWithAggregatesFilter<"platform_api_configs"> | string | null
    defaultModel?: StringNullableWithAggregatesFilter<"platform_api_configs"> | string | null
    defaultReasoningModel?: StringNullableWithAggregatesFilter<"platform_api_configs"> | string | null
    defaultEvaluationModel?: StringNullableWithAggregatesFilter<"platform_api_configs"> | string | null
    connectionStatus?: StringWithAggregatesFilter<"platform_api_configs"> | string
    lastCheckedAt?: DateTimeNullableWithAggregatesFilter<"platform_api_configs"> | Date | string | null
    createdAt?: DateTimeWithAggregatesFilter<"platform_api_configs"> | Date | string
    updatedAt?: DateTimeWithAggregatesFilter<"platform_api_configs"> | Date | string
    defaultTemperature?: FloatWithAggregatesFilter<"platform_api_configs"> | number
    defaultMaxTokens?: IntWithAggregatesFilter<"platform_api_configs"> | number
    reasoningEndpoint?: StringNullableWithAggregatesFilter<"platform_api_configs"> | string | null
    lightEndpoint?: StringNullableWithAggregatesFilter<"platform_api_configs"> | string | null
    chatModels?: StringNullableWithAggregatesFilter<"platform_api_configs"> | string | null
    reasoningModels?: StringNullableWithAggregatesFilter<"platform_api_configs"> | string | null
    lightModels?: StringNullableWithAggregatesFilter<"platform_api_configs"> | string | null
    adminAccessMode?: StringNullableWithAggregatesFilter<"platform_api_configs"> | string | null
    adminAllowedIps?: StringNullableWithAggregatesFilter<"platform_api_configs"> | string | null
    allowPrivateNetwork?: BoolNullableWithAggregatesFilter<"platform_api_configs"> | boolean | null
    privateNetworkHosts?: StringNullableWithAggregatesFilter<"platform_api_configs"> | string | null
  }

  export type platform_settingsWhereInput = {
    AND?: platform_settingsWhereInput | platform_settingsWhereInput[]
    OR?: platform_settingsWhereInput[]
    NOT?: platform_settingsWhereInput | platform_settingsWhereInput[]
    key?: StringFilter<"platform_settings"> | string
    value?: StringFilter<"platform_settings"> | string
    createdAt?: DateTimeFilter<"platform_settings"> | Date | string
    updatedAt?: DateTimeFilter<"platform_settings"> | Date | string
  }

  export type platform_settingsOrderByWithRelationInput = {
    key?: SortOrder
    value?: SortOrder
    createdAt?: SortOrder
    updatedAt?: SortOrder
  }

  export type platform_settingsWhereUniqueInput = Prisma.AtLeast<{
    key?: string
    AND?: platform_settingsWhereInput | platform_settingsWhereInput[]
    OR?: platform_settingsWhereInput[]
    NOT?: platform_settingsWhereInput | platform_settingsWhereInput[]
    value?: StringFilter<"platform_settings"> | string
    createdAt?: DateTimeFilter<"platform_settings"> | Date | string
    updatedAt?: DateTimeFilter<"platform_settings"> | Date | string
  }, "key">

  export type platform_settingsOrderByWithAggregationInput = {
    key?: SortOrder
    value?: SortOrder
    createdAt?: SortOrder
    updatedAt?: SortOrder
    _count?: platform_settingsCountOrderByAggregateInput
    _max?: platform_settingsMaxOrderByAggregateInput
    _min?: platform_settingsMinOrderByAggregateInput
  }

  export type platform_settingsScalarWhereWithAggregatesInput = {
    AND?: platform_settingsScalarWhereWithAggregatesInput | platform_settingsScalarWhereWithAggregatesInput[]
    OR?: platform_settingsScalarWhereWithAggregatesInput[]
    NOT?: platform_settingsScalarWhereWithAggregatesInput | platform_settingsScalarWhereWithAggregatesInput[]
    key?: StringWithAggregatesFilter<"platform_settings"> | string
    value?: StringWithAggregatesFilter<"platform_settings"> | string
    createdAt?: DateTimeWithAggregatesFilter<"platform_settings"> | Date | string
    updatedAt?: DateTimeWithAggregatesFilter<"platform_settings"> | Date | string
  }

  export type skill_model_configsWhereInput = {
    AND?: skill_model_configsWhereInput | skill_model_configsWhereInput[]
    OR?: skill_model_configsWhereInput[]
    NOT?: skill_model_configsWhereInput | skill_model_configsWhereInput[]
    id?: StringFilter<"skill_model_configs"> | string
    skillId?: StringFilter<"skill_model_configs"> | string
    tier?: StringFilter<"skill_model_configs"> | string
    model?: StringNullableFilter<"skill_model_configs"> | string | null
    thinkingMode?: StringNullableFilter<"skill_model_configs"> | string | null
    reasoningEffort?: StringNullableFilter<"skill_model_configs"> | string | null
    endpoint?: StringNullableFilter<"skill_model_configs"> | string | null
    apiKey?: StringNullableFilter<"skill_model_configs"> | string | null
    temperature?: FloatFilter<"skill_model_configs"> | number
    maxTokens?: IntFilter<"skill_model_configs"> | number
    requestTimeoutMs?: IntNullableFilter<"skill_model_configs"> | number | null
    enabled?: BoolFilter<"skill_model_configs"> | boolean
    createdAt?: DateTimeFilter<"skill_model_configs"> | Date | string
    updatedAt?: DateTimeFilter<"skill_model_configs"> | Date | string
  }

  export type skill_model_configsOrderByWithRelationInput = {
    id?: SortOrder
    skillId?: SortOrder
    tier?: SortOrder
    model?: SortOrderInput | SortOrder
    thinkingMode?: SortOrderInput | SortOrder
    reasoningEffort?: SortOrderInput | SortOrder
    endpoint?: SortOrderInput | SortOrder
    apiKey?: SortOrderInput | SortOrder
    temperature?: SortOrder
    maxTokens?: SortOrder
    requestTimeoutMs?: SortOrderInput | SortOrder
    enabled?: SortOrder
    createdAt?: SortOrder
    updatedAt?: SortOrder
  }

  export type skill_model_configsWhereUniqueInput = Prisma.AtLeast<{
    id?: string
    skillId?: string
    AND?: skill_model_configsWhereInput | skill_model_configsWhereInput[]
    OR?: skill_model_configsWhereInput[]
    NOT?: skill_model_configsWhereInput | skill_model_configsWhereInput[]
    tier?: StringFilter<"skill_model_configs"> | string
    model?: StringNullableFilter<"skill_model_configs"> | string | null
    thinkingMode?: StringNullableFilter<"skill_model_configs"> | string | null
    reasoningEffort?: StringNullableFilter<"skill_model_configs"> | string | null
    endpoint?: StringNullableFilter<"skill_model_configs"> | string | null
    apiKey?: StringNullableFilter<"skill_model_configs"> | string | null
    temperature?: FloatFilter<"skill_model_configs"> | number
    maxTokens?: IntFilter<"skill_model_configs"> | number
    requestTimeoutMs?: IntNullableFilter<"skill_model_configs"> | number | null
    enabled?: BoolFilter<"skill_model_configs"> | boolean
    createdAt?: DateTimeFilter<"skill_model_configs"> | Date | string
    updatedAt?: DateTimeFilter<"skill_model_configs"> | Date | string
  }, "id" | "skillId">

  export type skill_model_configsOrderByWithAggregationInput = {
    id?: SortOrder
    skillId?: SortOrder
    tier?: SortOrder
    model?: SortOrderInput | SortOrder
    thinkingMode?: SortOrderInput | SortOrder
    reasoningEffort?: SortOrderInput | SortOrder
    endpoint?: SortOrderInput | SortOrder
    apiKey?: SortOrderInput | SortOrder
    temperature?: SortOrder
    maxTokens?: SortOrder
    requestTimeoutMs?: SortOrderInput | SortOrder
    enabled?: SortOrder
    createdAt?: SortOrder
    updatedAt?: SortOrder
    _count?: skill_model_configsCountOrderByAggregateInput
    _avg?: skill_model_configsAvgOrderByAggregateInput
    _max?: skill_model_configsMaxOrderByAggregateInput
    _min?: skill_model_configsMinOrderByAggregateInput
    _sum?: skill_model_configsSumOrderByAggregateInput
  }

  export type skill_model_configsScalarWhereWithAggregatesInput = {
    AND?: skill_model_configsScalarWhereWithAggregatesInput | skill_model_configsScalarWhereWithAggregatesInput[]
    OR?: skill_model_configsScalarWhereWithAggregatesInput[]
    NOT?: skill_model_configsScalarWhereWithAggregatesInput | skill_model_configsScalarWhereWithAggregatesInput[]
    id?: StringWithAggregatesFilter<"skill_model_configs"> | string
    skillId?: StringWithAggregatesFilter<"skill_model_configs"> | string
    tier?: StringWithAggregatesFilter<"skill_model_configs"> | string
    model?: StringNullableWithAggregatesFilter<"skill_model_configs"> | string | null
    thinkingMode?: StringNullableWithAggregatesFilter<"skill_model_configs"> | string | null
    reasoningEffort?: StringNullableWithAggregatesFilter<"skill_model_configs"> | string | null
    endpoint?: StringNullableWithAggregatesFilter<"skill_model_configs"> | string | null
    apiKey?: StringNullableWithAggregatesFilter<"skill_model_configs"> | string | null
    temperature?: FloatWithAggregatesFilter<"skill_model_configs"> | number
    maxTokens?: IntWithAggregatesFilter<"skill_model_configs"> | number
    requestTimeoutMs?: IntNullableWithAggregatesFilter<"skill_model_configs"> | number | null
    enabled?: BoolWithAggregatesFilter<"skill_model_configs"> | boolean
    createdAt?: DateTimeWithAggregatesFilter<"skill_model_configs"> | Date | string
    updatedAt?: DateTimeWithAggregatesFilter<"skill_model_configs"> | Date | string
  }

  export type skill_registrationsWhereInput = {
    AND?: skill_registrationsWhereInput | skill_registrationsWhereInput[]
    OR?: skill_registrationsWhereInput[]
    NOT?: skill_registrationsWhereInput | skill_registrationsWhereInput[]
    id?: StringFilter<"skill_registrations"> | string
    name?: StringFilter<"skill_registrations"> | string
    version?: StringFilter<"skill_registrations"> | string
    category?: StringNullableFilter<"skill_registrations"> | string | null
    description?: StringNullableFilter<"skill_registrations"> | string | null
    inputSchema?: StringNullableFilter<"skill_registrations"> | string | null
    outputSchema?: StringNullableFilter<"skill_registrations"> | string | null
    endpoint?: StringNullableFilter<"skill_registrations"> | string | null
    callCount?: IntFilter<"skill_registrations"> | number
    successRate?: FloatFilter<"skill_registrations"> | number
    createdAt?: DateTimeFilter<"skill_registrations"> | Date | string
    updatedAt?: DateTimeFilter<"skill_registrations"> | Date | string
  }

  export type skill_registrationsOrderByWithRelationInput = {
    id?: SortOrder
    name?: SortOrder
    version?: SortOrder
    category?: SortOrderInput | SortOrder
    description?: SortOrderInput | SortOrder
    inputSchema?: SortOrderInput | SortOrder
    outputSchema?: SortOrderInput | SortOrder
    endpoint?: SortOrderInput | SortOrder
    callCount?: SortOrder
    successRate?: SortOrder
    createdAt?: SortOrder
    updatedAt?: SortOrder
  }

  export type skill_registrationsWhereUniqueInput = Prisma.AtLeast<{
    id?: string
    name?: string
    AND?: skill_registrationsWhereInput | skill_registrationsWhereInput[]
    OR?: skill_registrationsWhereInput[]
    NOT?: skill_registrationsWhereInput | skill_registrationsWhereInput[]
    version?: StringFilter<"skill_registrations"> | string
    category?: StringNullableFilter<"skill_registrations"> | string | null
    description?: StringNullableFilter<"skill_registrations"> | string | null
    inputSchema?: StringNullableFilter<"skill_registrations"> | string | null
    outputSchema?: StringNullableFilter<"skill_registrations"> | string | null
    endpoint?: StringNullableFilter<"skill_registrations"> | string | null
    callCount?: IntFilter<"skill_registrations"> | number
    successRate?: FloatFilter<"skill_registrations"> | number
    createdAt?: DateTimeFilter<"skill_registrations"> | Date | string
    updatedAt?: DateTimeFilter<"skill_registrations"> | Date | string
  }, "id" | "name">

  export type skill_registrationsOrderByWithAggregationInput = {
    id?: SortOrder
    name?: SortOrder
    version?: SortOrder
    category?: SortOrderInput | SortOrder
    description?: SortOrderInput | SortOrder
    inputSchema?: SortOrderInput | SortOrder
    outputSchema?: SortOrderInput | SortOrder
    endpoint?: SortOrderInput | SortOrder
    callCount?: SortOrder
    successRate?: SortOrder
    createdAt?: SortOrder
    updatedAt?: SortOrder
    _count?: skill_registrationsCountOrderByAggregateInput
    _avg?: skill_registrationsAvgOrderByAggregateInput
    _max?: skill_registrationsMaxOrderByAggregateInput
    _min?: skill_registrationsMinOrderByAggregateInput
    _sum?: skill_registrationsSumOrderByAggregateInput
  }

  export type skill_registrationsScalarWhereWithAggregatesInput = {
    AND?: skill_registrationsScalarWhereWithAggregatesInput | skill_registrationsScalarWhereWithAggregatesInput[]
    OR?: skill_registrationsScalarWhereWithAggregatesInput[]
    NOT?: skill_registrationsScalarWhereWithAggregatesInput | skill_registrationsScalarWhereWithAggregatesInput[]
    id?: StringWithAggregatesFilter<"skill_registrations"> | string
    name?: StringWithAggregatesFilter<"skill_registrations"> | string
    version?: StringWithAggregatesFilter<"skill_registrations"> | string
    category?: StringNullableWithAggregatesFilter<"skill_registrations"> | string | null
    description?: StringNullableWithAggregatesFilter<"skill_registrations"> | string | null
    inputSchema?: StringNullableWithAggregatesFilter<"skill_registrations"> | string | null
    outputSchema?: StringNullableWithAggregatesFilter<"skill_registrations"> | string | null
    endpoint?: StringNullableWithAggregatesFilter<"skill_registrations"> | string | null
    callCount?: IntWithAggregatesFilter<"skill_registrations"> | number
    successRate?: FloatWithAggregatesFilter<"skill_registrations"> | number
    createdAt?: DateTimeWithAggregatesFilter<"skill_registrations"> | Date | string
    updatedAt?: DateTimeWithAggregatesFilter<"skill_registrations"> | Date | string
  }

  export type field_definitionsWhereInput = {
    AND?: field_definitionsWhereInput | field_definitionsWhereInput[]
    OR?: field_definitionsWhereInput[]
    NOT?: field_definitionsWhereInput | field_definitionsWhereInput[]
    id?: StringFilter<"field_definitions"> | string
    fieldId?: StringFilter<"field_definitions"> | string
    stage?: StringFilter<"field_definitions"> | string
    promptRole?: StringFilter<"field_definitions"> | string
    valueType?: StringFilter<"field_definitions"> | string
    snakeName?: StringNullableFilter<"field_definitions"> | string | null
    camelName?: StringNullableFilter<"field_definitions"> | string | null
    description?: StringNullableFilter<"field_definitions"> | string | null
    enumValues?: StringNullableFilter<"field_definitions"> | string | null
    schemaVersion?: StringFilter<"field_definitions"> | string
    source?: StringFilter<"field_definitions"> | string
    managedByCode?: BoolFilter<"field_definitions"> | boolean
    systemLocked?: BoolFilter<"field_definitions"> | boolean
    structureLocked?: BoolFilter<"field_definitions"> | boolean
    bindings?: StringNullableFilter<"field_definitions"> | string | null
    metadata?: StringNullableFilter<"field_definitions"> | string | null
    createdAt?: DateTimeFilter<"field_definitions"> | Date | string
    updatedAt?: DateTimeFilter<"field_definitions"> | Date | string
  }

  export type field_definitionsOrderByWithRelationInput = {
    id?: SortOrder
    fieldId?: SortOrder
    stage?: SortOrder
    promptRole?: SortOrder
    valueType?: SortOrder
    snakeName?: SortOrderInput | SortOrder
    camelName?: SortOrderInput | SortOrder
    description?: SortOrderInput | SortOrder
    enumValues?: SortOrderInput | SortOrder
    schemaVersion?: SortOrder
    source?: SortOrder
    managedByCode?: SortOrder
    systemLocked?: SortOrder
    structureLocked?: SortOrder
    bindings?: SortOrderInput | SortOrder
    metadata?: SortOrderInput | SortOrder
    createdAt?: SortOrder
    updatedAt?: SortOrder
  }

  export type field_definitionsWhereUniqueInput = Prisma.AtLeast<{
    id?: string
    fieldId?: string
    AND?: field_definitionsWhereInput | field_definitionsWhereInput[]
    OR?: field_definitionsWhereInput[]
    NOT?: field_definitionsWhereInput | field_definitionsWhereInput[]
    stage?: StringFilter<"field_definitions"> | string
    promptRole?: StringFilter<"field_definitions"> | string
    valueType?: StringFilter<"field_definitions"> | string
    snakeName?: StringNullableFilter<"field_definitions"> | string | null
    camelName?: StringNullableFilter<"field_definitions"> | string | null
    description?: StringNullableFilter<"field_definitions"> | string | null
    enumValues?: StringNullableFilter<"field_definitions"> | string | null
    schemaVersion?: StringFilter<"field_definitions"> | string
    source?: StringFilter<"field_definitions"> | string
    managedByCode?: BoolFilter<"field_definitions"> | boolean
    systemLocked?: BoolFilter<"field_definitions"> | boolean
    structureLocked?: BoolFilter<"field_definitions"> | boolean
    bindings?: StringNullableFilter<"field_definitions"> | string | null
    metadata?: StringNullableFilter<"field_definitions"> | string | null
    createdAt?: DateTimeFilter<"field_definitions"> | Date | string
    updatedAt?: DateTimeFilter<"field_definitions"> | Date | string
  }, "id" | "fieldId">

  export type field_definitionsOrderByWithAggregationInput = {
    id?: SortOrder
    fieldId?: SortOrder
    stage?: SortOrder
    promptRole?: SortOrder
    valueType?: SortOrder
    snakeName?: SortOrderInput | SortOrder
    camelName?: SortOrderInput | SortOrder
    description?: SortOrderInput | SortOrder
    enumValues?: SortOrderInput | SortOrder
    schemaVersion?: SortOrder
    source?: SortOrder
    managedByCode?: SortOrder
    systemLocked?: SortOrder
    structureLocked?: SortOrder
    bindings?: SortOrderInput | SortOrder
    metadata?: SortOrderInput | SortOrder
    createdAt?: SortOrder
    updatedAt?: SortOrder
    _count?: field_definitionsCountOrderByAggregateInput
    _max?: field_definitionsMaxOrderByAggregateInput
    _min?: field_definitionsMinOrderByAggregateInput
  }

  export type field_definitionsScalarWhereWithAggregatesInput = {
    AND?: field_definitionsScalarWhereWithAggregatesInput | field_definitionsScalarWhereWithAggregatesInput[]
    OR?: field_definitionsScalarWhereWithAggregatesInput[]
    NOT?: field_definitionsScalarWhereWithAggregatesInput | field_definitionsScalarWhereWithAggregatesInput[]
    id?: StringWithAggregatesFilter<"field_definitions"> | string
    fieldId?: StringWithAggregatesFilter<"field_definitions"> | string
    stage?: StringWithAggregatesFilter<"field_definitions"> | string
    promptRole?: StringWithAggregatesFilter<"field_definitions"> | string
    valueType?: StringWithAggregatesFilter<"field_definitions"> | string
    snakeName?: StringNullableWithAggregatesFilter<"field_definitions"> | string | null
    camelName?: StringNullableWithAggregatesFilter<"field_definitions"> | string | null
    description?: StringNullableWithAggregatesFilter<"field_definitions"> | string | null
    enumValues?: StringNullableWithAggregatesFilter<"field_definitions"> | string | null
    schemaVersion?: StringWithAggregatesFilter<"field_definitions"> | string
    source?: StringWithAggregatesFilter<"field_definitions"> | string
    managedByCode?: BoolWithAggregatesFilter<"field_definitions"> | boolean
    systemLocked?: BoolWithAggregatesFilter<"field_definitions"> | boolean
    structureLocked?: BoolWithAggregatesFilter<"field_definitions"> | boolean
    bindings?: StringNullableWithAggregatesFilter<"field_definitions"> | string | null
    metadata?: StringNullableWithAggregatesFilter<"field_definitions"> | string | null
    createdAt?: DateTimeWithAggregatesFilter<"field_definitions"> | Date | string
    updatedAt?: DateTimeWithAggregatesFilter<"field_definitions"> | Date | string
  }

  export type agent_contractsWhereInput = {
    AND?: agent_contractsWhereInput | agent_contractsWhereInput[]
    OR?: agent_contractsWhereInput[]
    NOT?: agent_contractsWhereInput | agent_contractsWhereInput[]
    id?: StringFilter<"agent_contracts"> | string
    agentId?: StringFilter<"agent_contracts"> | string
    stage?: StringFilter<"agent_contracts"> | string
    displayName?: StringFilter<"agent_contracts"> | string
    description?: StringNullableFilter<"agent_contracts"> | string | null
    schemaVersion?: StringFilter<"agent_contracts"> | string
    source?: StringFilter<"agent_contracts"> | string
    managedByCode?: BoolFilter<"agent_contracts"> | boolean
    metadata?: StringNullableFilter<"agent_contracts"> | string | null
    createdAt?: DateTimeFilter<"agent_contracts"> | Date | string
    updatedAt?: DateTimeFilter<"agent_contracts"> | Date | string
  }

  export type agent_contractsOrderByWithRelationInput = {
    id?: SortOrder
    agentId?: SortOrder
    stage?: SortOrder
    displayName?: SortOrder
    description?: SortOrderInput | SortOrder
    schemaVersion?: SortOrder
    source?: SortOrder
    managedByCode?: SortOrder
    metadata?: SortOrderInput | SortOrder
    createdAt?: SortOrder
    updatedAt?: SortOrder
  }

  export type agent_contractsWhereUniqueInput = Prisma.AtLeast<{
    id?: string
    agentId?: string
    AND?: agent_contractsWhereInput | agent_contractsWhereInput[]
    OR?: agent_contractsWhereInput[]
    NOT?: agent_contractsWhereInput | agent_contractsWhereInput[]
    stage?: StringFilter<"agent_contracts"> | string
    displayName?: StringFilter<"agent_contracts"> | string
    description?: StringNullableFilter<"agent_contracts"> | string | null
    schemaVersion?: StringFilter<"agent_contracts"> | string
    source?: StringFilter<"agent_contracts"> | string
    managedByCode?: BoolFilter<"agent_contracts"> | boolean
    metadata?: StringNullableFilter<"agent_contracts"> | string | null
    createdAt?: DateTimeFilter<"agent_contracts"> | Date | string
    updatedAt?: DateTimeFilter<"agent_contracts"> | Date | string
  }, "id" | "agentId">

  export type agent_contractsOrderByWithAggregationInput = {
    id?: SortOrder
    agentId?: SortOrder
    stage?: SortOrder
    displayName?: SortOrder
    description?: SortOrderInput | SortOrder
    schemaVersion?: SortOrder
    source?: SortOrder
    managedByCode?: SortOrder
    metadata?: SortOrderInput | SortOrder
    createdAt?: SortOrder
    updatedAt?: SortOrder
    _count?: agent_contractsCountOrderByAggregateInput
    _max?: agent_contractsMaxOrderByAggregateInput
    _min?: agent_contractsMinOrderByAggregateInput
  }

  export type agent_contractsScalarWhereWithAggregatesInput = {
    AND?: agent_contractsScalarWhereWithAggregatesInput | agent_contractsScalarWhereWithAggregatesInput[]
    OR?: agent_contractsScalarWhereWithAggregatesInput[]
    NOT?: agent_contractsScalarWhereWithAggregatesInput | agent_contractsScalarWhereWithAggregatesInput[]
    id?: StringWithAggregatesFilter<"agent_contracts"> | string
    agentId?: StringWithAggregatesFilter<"agent_contracts"> | string
    stage?: StringWithAggregatesFilter<"agent_contracts"> | string
    displayName?: StringWithAggregatesFilter<"agent_contracts"> | string
    description?: StringNullableWithAggregatesFilter<"agent_contracts"> | string | null
    schemaVersion?: StringWithAggregatesFilter<"agent_contracts"> | string
    source?: StringWithAggregatesFilter<"agent_contracts"> | string
    managedByCode?: BoolWithAggregatesFilter<"agent_contracts"> | boolean
    metadata?: StringNullableWithAggregatesFilter<"agent_contracts"> | string | null
    createdAt?: DateTimeWithAggregatesFilter<"agent_contracts"> | Date | string
    updatedAt?: DateTimeWithAggregatesFilter<"agent_contracts"> | Date | string
  }

  export type agent_field_routingsWhereInput = {
    AND?: agent_field_routingsWhereInput | agent_field_routingsWhereInput[]
    OR?: agent_field_routingsWhereInput[]
    NOT?: agent_field_routingsWhereInput | agent_field_routingsWhereInput[]
    id?: StringFilter<"agent_field_routings"> | string
    agentId?: StringFilter<"agent_field_routings"> | string
    fieldId?: StringFilter<"agent_field_routings"> | string
    render?: StringFilter<"agent_field_routings"> | string
    handoff?: StringNullableFilter<"agent_field_routings"> | string | null
    internalFlag?: BoolFilter<"agent_field_routings"> | boolean
    accumulate?: BoolFilter<"agent_field_routings"> | boolean
    visibilityPreset?: StringNullableFilter<"agent_field_routings"> | string | null
    ordering?: IntFilter<"agent_field_routings"> | number
    notes?: StringNullableFilter<"agent_field_routings"> | string | null
    source?: StringFilter<"agent_field_routings"> | string
    managedByCode?: BoolFilter<"agent_field_routings"> | boolean
    systemLocked?: BoolFilter<"agent_field_routings"> | boolean
    structureLocked?: BoolFilter<"agent_field_routings"> | boolean
    createdAt?: DateTimeFilter<"agent_field_routings"> | Date | string
    updatedAt?: DateTimeFilter<"agent_field_routings"> | Date | string
  }

  export type agent_field_routingsOrderByWithRelationInput = {
    id?: SortOrder
    agentId?: SortOrder
    fieldId?: SortOrder
    render?: SortOrder
    handoff?: SortOrderInput | SortOrder
    internalFlag?: SortOrder
    accumulate?: SortOrder
    visibilityPreset?: SortOrderInput | SortOrder
    ordering?: SortOrder
    notes?: SortOrderInput | SortOrder
    source?: SortOrder
    managedByCode?: SortOrder
    systemLocked?: SortOrder
    structureLocked?: SortOrder
    createdAt?: SortOrder
    updatedAt?: SortOrder
  }

  export type agent_field_routingsWhereUniqueInput = Prisma.AtLeast<{
    id?: string
    agentId_fieldId?: agent_field_routingsAgentIdFieldIdCompoundUniqueInput
    AND?: agent_field_routingsWhereInput | agent_field_routingsWhereInput[]
    OR?: agent_field_routingsWhereInput[]
    NOT?: agent_field_routingsWhereInput | agent_field_routingsWhereInput[]
    agentId?: StringFilter<"agent_field_routings"> | string
    fieldId?: StringFilter<"agent_field_routings"> | string
    render?: StringFilter<"agent_field_routings"> | string
    handoff?: StringNullableFilter<"agent_field_routings"> | string | null
    internalFlag?: BoolFilter<"agent_field_routings"> | boolean
    accumulate?: BoolFilter<"agent_field_routings"> | boolean
    visibilityPreset?: StringNullableFilter<"agent_field_routings"> | string | null
    ordering?: IntFilter<"agent_field_routings"> | number
    notes?: StringNullableFilter<"agent_field_routings"> | string | null
    source?: StringFilter<"agent_field_routings"> | string
    managedByCode?: BoolFilter<"agent_field_routings"> | boolean
    systemLocked?: BoolFilter<"agent_field_routings"> | boolean
    structureLocked?: BoolFilter<"agent_field_routings"> | boolean
    createdAt?: DateTimeFilter<"agent_field_routings"> | Date | string
    updatedAt?: DateTimeFilter<"agent_field_routings"> | Date | string
  }, "id" | "agentId_fieldId">

  export type agent_field_routingsOrderByWithAggregationInput = {
    id?: SortOrder
    agentId?: SortOrder
    fieldId?: SortOrder
    render?: SortOrder
    handoff?: SortOrderInput | SortOrder
    internalFlag?: SortOrder
    accumulate?: SortOrder
    visibilityPreset?: SortOrderInput | SortOrder
    ordering?: SortOrder
    notes?: SortOrderInput | SortOrder
    source?: SortOrder
    managedByCode?: SortOrder
    systemLocked?: SortOrder
    structureLocked?: SortOrder
    createdAt?: SortOrder
    updatedAt?: SortOrder
    _count?: agent_field_routingsCountOrderByAggregateInput
    _avg?: agent_field_routingsAvgOrderByAggregateInput
    _max?: agent_field_routingsMaxOrderByAggregateInput
    _min?: agent_field_routingsMinOrderByAggregateInput
    _sum?: agent_field_routingsSumOrderByAggregateInput
  }

  export type agent_field_routingsScalarWhereWithAggregatesInput = {
    AND?: agent_field_routingsScalarWhereWithAggregatesInput | agent_field_routingsScalarWhereWithAggregatesInput[]
    OR?: agent_field_routingsScalarWhereWithAggregatesInput[]
    NOT?: agent_field_routingsScalarWhereWithAggregatesInput | agent_field_routingsScalarWhereWithAggregatesInput[]
    id?: StringWithAggregatesFilter<"agent_field_routings"> | string
    agentId?: StringWithAggregatesFilter<"agent_field_routings"> | string
    fieldId?: StringWithAggregatesFilter<"agent_field_routings"> | string
    render?: StringWithAggregatesFilter<"agent_field_routings"> | string
    handoff?: StringNullableWithAggregatesFilter<"agent_field_routings"> | string | null
    internalFlag?: BoolWithAggregatesFilter<"agent_field_routings"> | boolean
    accumulate?: BoolWithAggregatesFilter<"agent_field_routings"> | boolean
    visibilityPreset?: StringNullableWithAggregatesFilter<"agent_field_routings"> | string | null
    ordering?: IntWithAggregatesFilter<"agent_field_routings"> | number
    notes?: StringNullableWithAggregatesFilter<"agent_field_routings"> | string | null
    source?: StringWithAggregatesFilter<"agent_field_routings"> | string
    managedByCode?: BoolWithAggregatesFilter<"agent_field_routings"> | boolean
    systemLocked?: BoolWithAggregatesFilter<"agent_field_routings"> | boolean
    structureLocked?: BoolWithAggregatesFilter<"agent_field_routings"> | boolean
    createdAt?: DateTimeWithAggregatesFilter<"agent_field_routings"> | Date | string
    updatedAt?: DateTimeWithAggregatesFilter<"agent_field_routings"> | Date | string
  }

  export type node_config_changesWhereInput = {
    AND?: node_config_changesWhereInput | node_config_changesWhereInput[]
    OR?: node_config_changesWhereInput[]
    NOT?: node_config_changesWhereInput | node_config_changesWhereInput[]
    id?: StringFilter<"node_config_changes"> | string
    changeType?: StringFilter<"node_config_changes"> | string
    targetTable?: StringFilter<"node_config_changes"> | string
    targetId?: StringFilter<"node_config_changes"> | string
    agentId?: StringNullableFilter<"node_config_changes"> | string | null
    fieldId?: StringNullableFilter<"node_config_changes"> | string | null
    before?: StringNullableFilter<"node_config_changes"> | string | null
    after?: StringNullableFilter<"node_config_changes"> | string | null
    actorId?: StringNullableFilter<"node_config_changes"> | string | null
    actorRole?: StringNullableFilter<"node_config_changes"> | string | null
    reason?: StringNullableFilter<"node_config_changes"> | string | null
    createdAt?: DateTimeFilter<"node_config_changes"> | Date | string
  }

  export type node_config_changesOrderByWithRelationInput = {
    id?: SortOrder
    changeType?: SortOrder
    targetTable?: SortOrder
    targetId?: SortOrder
    agentId?: SortOrderInput | SortOrder
    fieldId?: SortOrderInput | SortOrder
    before?: SortOrderInput | SortOrder
    after?: SortOrderInput | SortOrder
    actorId?: SortOrderInput | SortOrder
    actorRole?: SortOrderInput | SortOrder
    reason?: SortOrderInput | SortOrder
    createdAt?: SortOrder
  }

  export type node_config_changesWhereUniqueInput = Prisma.AtLeast<{
    id?: string
    AND?: node_config_changesWhereInput | node_config_changesWhereInput[]
    OR?: node_config_changesWhereInput[]
    NOT?: node_config_changesWhereInput | node_config_changesWhereInput[]
    changeType?: StringFilter<"node_config_changes"> | string
    targetTable?: StringFilter<"node_config_changes"> | string
    targetId?: StringFilter<"node_config_changes"> | string
    agentId?: StringNullableFilter<"node_config_changes"> | string | null
    fieldId?: StringNullableFilter<"node_config_changes"> | string | null
    before?: StringNullableFilter<"node_config_changes"> | string | null
    after?: StringNullableFilter<"node_config_changes"> | string | null
    actorId?: StringNullableFilter<"node_config_changes"> | string | null
    actorRole?: StringNullableFilter<"node_config_changes"> | string | null
    reason?: StringNullableFilter<"node_config_changes"> | string | null
    createdAt?: DateTimeFilter<"node_config_changes"> | Date | string
  }, "id">

  export type node_config_changesOrderByWithAggregationInput = {
    id?: SortOrder
    changeType?: SortOrder
    targetTable?: SortOrder
    targetId?: SortOrder
    agentId?: SortOrderInput | SortOrder
    fieldId?: SortOrderInput | SortOrder
    before?: SortOrderInput | SortOrder
    after?: SortOrderInput | SortOrder
    actorId?: SortOrderInput | SortOrder
    actorRole?: SortOrderInput | SortOrder
    reason?: SortOrderInput | SortOrder
    createdAt?: SortOrder
    _count?: node_config_changesCountOrderByAggregateInput
    _max?: node_config_changesMaxOrderByAggregateInput
    _min?: node_config_changesMinOrderByAggregateInput
  }

  export type node_config_changesScalarWhereWithAggregatesInput = {
    AND?: node_config_changesScalarWhereWithAggregatesInput | node_config_changesScalarWhereWithAggregatesInput[]
    OR?: node_config_changesScalarWhereWithAggregatesInput[]
    NOT?: node_config_changesScalarWhereWithAggregatesInput | node_config_changesScalarWhereWithAggregatesInput[]
    id?: StringWithAggregatesFilter<"node_config_changes"> | string
    changeType?: StringWithAggregatesFilter<"node_config_changes"> | string
    targetTable?: StringWithAggregatesFilter<"node_config_changes"> | string
    targetId?: StringWithAggregatesFilter<"node_config_changes"> | string
    agentId?: StringNullableWithAggregatesFilter<"node_config_changes"> | string | null
    fieldId?: StringNullableWithAggregatesFilter<"node_config_changes"> | string | null
    before?: StringNullableWithAggregatesFilter<"node_config_changes"> | string | null
    after?: StringNullableWithAggregatesFilter<"node_config_changes"> | string | null
    actorId?: StringNullableWithAggregatesFilter<"node_config_changes"> | string | null
    actorRole?: StringNullableWithAggregatesFilter<"node_config_changes"> | string | null
    reason?: StringNullableWithAggregatesFilter<"node_config_changes"> | string | null
    createdAt?: DateTimeWithAggregatesFilter<"node_config_changes"> | Date | string
  }

  export type prompt_eval_casesWhereInput = {
    AND?: prompt_eval_casesWhereInput | prompt_eval_casesWhereInput[]
    OR?: prompt_eval_casesWhereInput[]
    NOT?: prompt_eval_casesWhereInput | prompt_eval_casesWhereInput[]
    id?: StringFilter<"prompt_eval_cases"> | string
    agentId?: StringFilter<"prompt_eval_cases"> | string
    caseId?: StringFilter<"prompt_eval_cases"> | string
    name?: StringFilter<"prompt_eval_cases"> | string
    description?: StringNullableFilter<"prompt_eval_cases"> | string | null
    messagesJson?: StringFilter<"prompt_eval_cases"> | string
    previousStateJson?: StringNullableFilter<"prompt_eval_cases"> | string | null
    expectationsJson?: StringNullableFilter<"prompt_eval_cases"> | string | null
    enabled?: BoolFilter<"prompt_eval_cases"> | boolean
    createdBy?: StringNullableFilter<"prompt_eval_cases"> | string | null
    createdAt?: DateTimeFilter<"prompt_eval_cases"> | Date | string
    updatedAt?: DateTimeFilter<"prompt_eval_cases"> | Date | string
  }

  export type prompt_eval_casesOrderByWithRelationInput = {
    id?: SortOrder
    agentId?: SortOrder
    caseId?: SortOrder
    name?: SortOrder
    description?: SortOrderInput | SortOrder
    messagesJson?: SortOrder
    previousStateJson?: SortOrderInput | SortOrder
    expectationsJson?: SortOrderInput | SortOrder
    enabled?: SortOrder
    createdBy?: SortOrderInput | SortOrder
    createdAt?: SortOrder
    updatedAt?: SortOrder
  }

  export type prompt_eval_casesWhereUniqueInput = Prisma.AtLeast<{
    id?: string
    agentId_caseId?: prompt_eval_casesAgentIdCaseIdCompoundUniqueInput
    AND?: prompt_eval_casesWhereInput | prompt_eval_casesWhereInput[]
    OR?: prompt_eval_casesWhereInput[]
    NOT?: prompt_eval_casesWhereInput | prompt_eval_casesWhereInput[]
    agentId?: StringFilter<"prompt_eval_cases"> | string
    caseId?: StringFilter<"prompt_eval_cases"> | string
    name?: StringFilter<"prompt_eval_cases"> | string
    description?: StringNullableFilter<"prompt_eval_cases"> | string | null
    messagesJson?: StringFilter<"prompt_eval_cases"> | string
    previousStateJson?: StringNullableFilter<"prompt_eval_cases"> | string | null
    expectationsJson?: StringNullableFilter<"prompt_eval_cases"> | string | null
    enabled?: BoolFilter<"prompt_eval_cases"> | boolean
    createdBy?: StringNullableFilter<"prompt_eval_cases"> | string | null
    createdAt?: DateTimeFilter<"prompt_eval_cases"> | Date | string
    updatedAt?: DateTimeFilter<"prompt_eval_cases"> | Date | string
  }, "id" | "agentId_caseId">

  export type prompt_eval_casesOrderByWithAggregationInput = {
    id?: SortOrder
    agentId?: SortOrder
    caseId?: SortOrder
    name?: SortOrder
    description?: SortOrderInput | SortOrder
    messagesJson?: SortOrder
    previousStateJson?: SortOrderInput | SortOrder
    expectationsJson?: SortOrderInput | SortOrder
    enabled?: SortOrder
    createdBy?: SortOrderInput | SortOrder
    createdAt?: SortOrder
    updatedAt?: SortOrder
    _count?: prompt_eval_casesCountOrderByAggregateInput
    _max?: prompt_eval_casesMaxOrderByAggregateInput
    _min?: prompt_eval_casesMinOrderByAggregateInput
  }

  export type prompt_eval_casesScalarWhereWithAggregatesInput = {
    AND?: prompt_eval_casesScalarWhereWithAggregatesInput | prompt_eval_casesScalarWhereWithAggregatesInput[]
    OR?: prompt_eval_casesScalarWhereWithAggregatesInput[]
    NOT?: prompt_eval_casesScalarWhereWithAggregatesInput | prompt_eval_casesScalarWhereWithAggregatesInput[]
    id?: StringWithAggregatesFilter<"prompt_eval_cases"> | string
    agentId?: StringWithAggregatesFilter<"prompt_eval_cases"> | string
    caseId?: StringWithAggregatesFilter<"prompt_eval_cases"> | string
    name?: StringWithAggregatesFilter<"prompt_eval_cases"> | string
    description?: StringNullableWithAggregatesFilter<"prompt_eval_cases"> | string | null
    messagesJson?: StringWithAggregatesFilter<"prompt_eval_cases"> | string
    previousStateJson?: StringNullableWithAggregatesFilter<"prompt_eval_cases"> | string | null
    expectationsJson?: StringNullableWithAggregatesFilter<"prompt_eval_cases"> | string | null
    enabled?: BoolWithAggregatesFilter<"prompt_eval_cases"> | boolean
    createdBy?: StringNullableWithAggregatesFilter<"prompt_eval_cases"> | string | null
    createdAt?: DateTimeWithAggregatesFilter<"prompt_eval_cases"> | Date | string
    updatedAt?: DateTimeWithAggregatesFilter<"prompt_eval_cases"> | Date | string
  }

  export type prompt_eval_runsWhereInput = {
    AND?: prompt_eval_runsWhereInput | prompt_eval_runsWhereInput[]
    OR?: prompt_eval_runsWhereInput[]
    NOT?: prompt_eval_runsWhereInput | prompt_eval_runsWhereInput[]
    id?: StringFilter<"prompt_eval_runs"> | string
    agentId?: StringFilter<"prompt_eval_runs"> | string
    promptVersionId?: StringNullableFilter<"prompt_eval_runs"> | string | null
    promptVersion?: IntNullableFilter<"prompt_eval_runs"> | number | null
    promptSource?: StringFilter<"prompt_eval_runs"> | string
    mode?: StringFilter<"prompt_eval_runs"> | string
    caseCount?: IntFilter<"prompt_eval_runs"> | number
    totalRuns?: IntFilter<"prompt_eval_runs"> | number
    summaryJson?: StringFilter<"prompt_eval_runs"> | string
    resultsJson?: StringNullableFilter<"prompt_eval_runs"> | string | null
    durationMs?: IntFilter<"prompt_eval_runs"> | number
    triggeredBy?: StringNullableFilter<"prompt_eval_runs"> | string | null
    createdAt?: DateTimeFilter<"prompt_eval_runs"> | Date | string
  }

  export type prompt_eval_runsOrderByWithRelationInput = {
    id?: SortOrder
    agentId?: SortOrder
    promptVersionId?: SortOrderInput | SortOrder
    promptVersion?: SortOrderInput | SortOrder
    promptSource?: SortOrder
    mode?: SortOrder
    caseCount?: SortOrder
    totalRuns?: SortOrder
    summaryJson?: SortOrder
    resultsJson?: SortOrderInput | SortOrder
    durationMs?: SortOrder
    triggeredBy?: SortOrderInput | SortOrder
    createdAt?: SortOrder
  }

  export type prompt_eval_runsWhereUniqueInput = Prisma.AtLeast<{
    id?: string
    AND?: prompt_eval_runsWhereInput | prompt_eval_runsWhereInput[]
    OR?: prompt_eval_runsWhereInput[]
    NOT?: prompt_eval_runsWhereInput | prompt_eval_runsWhereInput[]
    agentId?: StringFilter<"prompt_eval_runs"> | string
    promptVersionId?: StringNullableFilter<"prompt_eval_runs"> | string | null
    promptVersion?: IntNullableFilter<"prompt_eval_runs"> | number | null
    promptSource?: StringFilter<"prompt_eval_runs"> | string
    mode?: StringFilter<"prompt_eval_runs"> | string
    caseCount?: IntFilter<"prompt_eval_runs"> | number
    totalRuns?: IntFilter<"prompt_eval_runs"> | number
    summaryJson?: StringFilter<"prompt_eval_runs"> | string
    resultsJson?: StringNullableFilter<"prompt_eval_runs"> | string | null
    durationMs?: IntFilter<"prompt_eval_runs"> | number
    triggeredBy?: StringNullableFilter<"prompt_eval_runs"> | string | null
    createdAt?: DateTimeFilter<"prompt_eval_runs"> | Date | string
  }, "id">

  export type prompt_eval_runsOrderByWithAggregationInput = {
    id?: SortOrder
    agentId?: SortOrder
    promptVersionId?: SortOrderInput | SortOrder
    promptVersion?: SortOrderInput | SortOrder
    promptSource?: SortOrder
    mode?: SortOrder
    caseCount?: SortOrder
    totalRuns?: SortOrder
    summaryJson?: SortOrder
    resultsJson?: SortOrderInput | SortOrder
    durationMs?: SortOrder
    triggeredBy?: SortOrderInput | SortOrder
    createdAt?: SortOrder
    _count?: prompt_eval_runsCountOrderByAggregateInput
    _avg?: prompt_eval_runsAvgOrderByAggregateInput
    _max?: prompt_eval_runsMaxOrderByAggregateInput
    _min?: prompt_eval_runsMinOrderByAggregateInput
    _sum?: prompt_eval_runsSumOrderByAggregateInput
  }

  export type prompt_eval_runsScalarWhereWithAggregatesInput = {
    AND?: prompt_eval_runsScalarWhereWithAggregatesInput | prompt_eval_runsScalarWhereWithAggregatesInput[]
    OR?: prompt_eval_runsScalarWhereWithAggregatesInput[]
    NOT?: prompt_eval_runsScalarWhereWithAggregatesInput | prompt_eval_runsScalarWhereWithAggregatesInput[]
    id?: StringWithAggregatesFilter<"prompt_eval_runs"> | string
    agentId?: StringWithAggregatesFilter<"prompt_eval_runs"> | string
    promptVersionId?: StringNullableWithAggregatesFilter<"prompt_eval_runs"> | string | null
    promptVersion?: IntNullableWithAggregatesFilter<"prompt_eval_runs"> | number | null
    promptSource?: StringWithAggregatesFilter<"prompt_eval_runs"> | string
    mode?: StringWithAggregatesFilter<"prompt_eval_runs"> | string
    caseCount?: IntWithAggregatesFilter<"prompt_eval_runs"> | number
    totalRuns?: IntWithAggregatesFilter<"prompt_eval_runs"> | number
    summaryJson?: StringWithAggregatesFilter<"prompt_eval_runs"> | string
    resultsJson?: StringNullableWithAggregatesFilter<"prompt_eval_runs"> | string | null
    durationMs?: IntWithAggregatesFilter<"prompt_eval_runs"> | number
    triggeredBy?: StringNullableWithAggregatesFilter<"prompt_eval_runs"> | string | null
    createdAt?: DateTimeWithAggregatesFilter<"prompt_eval_runs"> | Date | string
  }

  export type agent_lab_configsCreateInput = {
    id: string
    agentName: string
    model?: string | null
    temperature?: number | null
    maxTokens?: number | null
    baseURL?: string | null
    apiKey?: string | null
    systemPrompt?: string | null
    extraConfig?: string | null
    createdAt?: Date | string
    updatedAt: Date | string
  }

  export type agent_lab_configsUncheckedCreateInput = {
    id: string
    agentName: string
    model?: string | null
    temperature?: number | null
    maxTokens?: number | null
    baseURL?: string | null
    apiKey?: string | null
    systemPrompt?: string | null
    extraConfig?: string | null
    createdAt?: Date | string
    updatedAt: Date | string
  }

  export type agent_lab_configsUpdateInput = {
    id?: StringFieldUpdateOperationsInput | string
    agentName?: StringFieldUpdateOperationsInput | string
    model?: NullableStringFieldUpdateOperationsInput | string | null
    temperature?: NullableFloatFieldUpdateOperationsInput | number | null
    maxTokens?: NullableIntFieldUpdateOperationsInput | number | null
    baseURL?: NullableStringFieldUpdateOperationsInput | string | null
    apiKey?: NullableStringFieldUpdateOperationsInput | string | null
    systemPrompt?: NullableStringFieldUpdateOperationsInput | string | null
    extraConfig?: NullableStringFieldUpdateOperationsInput | string | null
    createdAt?: DateTimeFieldUpdateOperationsInput | Date | string
    updatedAt?: DateTimeFieldUpdateOperationsInput | Date | string
  }

  export type agent_lab_configsUncheckedUpdateInput = {
    id?: StringFieldUpdateOperationsInput | string
    agentName?: StringFieldUpdateOperationsInput | string
    model?: NullableStringFieldUpdateOperationsInput | string | null
    temperature?: NullableFloatFieldUpdateOperationsInput | number | null
    maxTokens?: NullableIntFieldUpdateOperationsInput | number | null
    baseURL?: NullableStringFieldUpdateOperationsInput | string | null
    apiKey?: NullableStringFieldUpdateOperationsInput | string | null
    systemPrompt?: NullableStringFieldUpdateOperationsInput | string | null
    extraConfig?: NullableStringFieldUpdateOperationsInput | string | null
    createdAt?: DateTimeFieldUpdateOperationsInput | Date | string
    updatedAt?: DateTimeFieldUpdateOperationsInput | Date | string
  }

  export type agent_lab_configsCreateManyInput = {
    id: string
    agentName: string
    model?: string | null
    temperature?: number | null
    maxTokens?: number | null
    baseURL?: string | null
    apiKey?: string | null
    systemPrompt?: string | null
    extraConfig?: string | null
    createdAt?: Date | string
    updatedAt: Date | string
  }

  export type agent_lab_configsUpdateManyMutationInput = {
    id?: StringFieldUpdateOperationsInput | string
    agentName?: StringFieldUpdateOperationsInput | string
    model?: NullableStringFieldUpdateOperationsInput | string | null
    temperature?: NullableFloatFieldUpdateOperationsInput | number | null
    maxTokens?: NullableIntFieldUpdateOperationsInput | number | null
    baseURL?: NullableStringFieldUpdateOperationsInput | string | null
    apiKey?: NullableStringFieldUpdateOperationsInput | string | null
    systemPrompt?: NullableStringFieldUpdateOperationsInput | string | null
    extraConfig?: NullableStringFieldUpdateOperationsInput | string | null
    createdAt?: DateTimeFieldUpdateOperationsInput | Date | string
    updatedAt?: DateTimeFieldUpdateOperationsInput | Date | string
  }

  export type agent_lab_configsUncheckedUpdateManyInput = {
    id?: StringFieldUpdateOperationsInput | string
    agentName?: StringFieldUpdateOperationsInput | string
    model?: NullableStringFieldUpdateOperationsInput | string | null
    temperature?: NullableFloatFieldUpdateOperationsInput | number | null
    maxTokens?: NullableIntFieldUpdateOperationsInput | number | null
    baseURL?: NullableStringFieldUpdateOperationsInput | string | null
    apiKey?: NullableStringFieldUpdateOperationsInput | string | null
    systemPrompt?: NullableStringFieldUpdateOperationsInput | string | null
    extraConfig?: NullableStringFieldUpdateOperationsInput | string | null
    createdAt?: DateTimeFieldUpdateOperationsInput | Date | string
    updatedAt?: DateTimeFieldUpdateOperationsInput | Date | string
  }

  export type agent_model_configsCreateInput = {
    id: string
    agentId: string
    tier?: string
    model?: string | null
    endpoint?: string | null
    apiKey?: string | null
    temperature?: number
    maxTokens?: number
    priority?: number
    enabled?: boolean
    createdAt?: Date | string
    updatedAt: Date | string
    reasoningEffort?: string | null
    thinkingMode?: string | null
  }

  export type agent_model_configsUncheckedCreateInput = {
    id: string
    agentId: string
    tier?: string
    model?: string | null
    endpoint?: string | null
    apiKey?: string | null
    temperature?: number
    maxTokens?: number
    priority?: number
    enabled?: boolean
    createdAt?: Date | string
    updatedAt: Date | string
    reasoningEffort?: string | null
    thinkingMode?: string | null
  }

  export type agent_model_configsUpdateInput = {
    id?: StringFieldUpdateOperationsInput | string
    agentId?: StringFieldUpdateOperationsInput | string
    tier?: StringFieldUpdateOperationsInput | string
    model?: NullableStringFieldUpdateOperationsInput | string | null
    endpoint?: NullableStringFieldUpdateOperationsInput | string | null
    apiKey?: NullableStringFieldUpdateOperationsInput | string | null
    temperature?: FloatFieldUpdateOperationsInput | number
    maxTokens?: IntFieldUpdateOperationsInput | number
    priority?: IntFieldUpdateOperationsInput | number
    enabled?: BoolFieldUpdateOperationsInput | boolean
    createdAt?: DateTimeFieldUpdateOperationsInput | Date | string
    updatedAt?: DateTimeFieldUpdateOperationsInput | Date | string
    reasoningEffort?: NullableStringFieldUpdateOperationsInput | string | null
    thinkingMode?: NullableStringFieldUpdateOperationsInput | string | null
  }

  export type agent_model_configsUncheckedUpdateInput = {
    id?: StringFieldUpdateOperationsInput | string
    agentId?: StringFieldUpdateOperationsInput | string
    tier?: StringFieldUpdateOperationsInput | string
    model?: NullableStringFieldUpdateOperationsInput | string | null
    endpoint?: NullableStringFieldUpdateOperationsInput | string | null
    apiKey?: NullableStringFieldUpdateOperationsInput | string | null
    temperature?: FloatFieldUpdateOperationsInput | number
    maxTokens?: IntFieldUpdateOperationsInput | number
    priority?: IntFieldUpdateOperationsInput | number
    enabled?: BoolFieldUpdateOperationsInput | boolean
    createdAt?: DateTimeFieldUpdateOperationsInput | Date | string
    updatedAt?: DateTimeFieldUpdateOperationsInput | Date | string
    reasoningEffort?: NullableStringFieldUpdateOperationsInput | string | null
    thinkingMode?: NullableStringFieldUpdateOperationsInput | string | null
  }

  export type agent_model_configsCreateManyInput = {
    id: string
    agentId: string
    tier?: string
    model?: string | null
    endpoint?: string | null
    apiKey?: string | null
    temperature?: number
    maxTokens?: number
    priority?: number
    enabled?: boolean
    createdAt?: Date | string
    updatedAt: Date | string
    reasoningEffort?: string | null
    thinkingMode?: string | null
  }

  export type agent_model_configsUpdateManyMutationInput = {
    id?: StringFieldUpdateOperationsInput | string
    agentId?: StringFieldUpdateOperationsInput | string
    tier?: StringFieldUpdateOperationsInput | string
    model?: NullableStringFieldUpdateOperationsInput | string | null
    endpoint?: NullableStringFieldUpdateOperationsInput | string | null
    apiKey?: NullableStringFieldUpdateOperationsInput | string | null
    temperature?: FloatFieldUpdateOperationsInput | number
    maxTokens?: IntFieldUpdateOperationsInput | number
    priority?: IntFieldUpdateOperationsInput | number
    enabled?: BoolFieldUpdateOperationsInput | boolean
    createdAt?: DateTimeFieldUpdateOperationsInput | Date | string
    updatedAt?: DateTimeFieldUpdateOperationsInput | Date | string
    reasoningEffort?: NullableStringFieldUpdateOperationsInput | string | null
    thinkingMode?: NullableStringFieldUpdateOperationsInput | string | null
  }

  export type agent_model_configsUncheckedUpdateManyInput = {
    id?: StringFieldUpdateOperationsInput | string
    agentId?: StringFieldUpdateOperationsInput | string
    tier?: StringFieldUpdateOperationsInput | string
    model?: NullableStringFieldUpdateOperationsInput | string | null
    endpoint?: NullableStringFieldUpdateOperationsInput | string | null
    apiKey?: NullableStringFieldUpdateOperationsInput | string | null
    temperature?: FloatFieldUpdateOperationsInput | number
    maxTokens?: IntFieldUpdateOperationsInput | number
    priority?: IntFieldUpdateOperationsInput | number
    enabled?: BoolFieldUpdateOperationsInput | boolean
    createdAt?: DateTimeFieldUpdateOperationsInput | Date | string
    updatedAt?: DateTimeFieldUpdateOperationsInput | Date | string
    reasoningEffort?: NullableStringFieldUpdateOperationsInput | string | null
    thinkingMode?: NullableStringFieldUpdateOperationsInput | string | null
  }

  export type agent_promptsCreateInput = {
    id: string
    agentId: string
    version: number
    name: string
    description?: string | null
    systemPrompt: string
    compiledSystemPrompt?: string | null
    compileStatus?: string | null
    compileError?: string | null
    sourceHash?: string | null
    compileContextHash?: string | null
    compiledAt?: Date | string | null
    temperature?: number | null
    maxTokens?: number | null
    model?: string | null
    status?: string
    createdBy: string
    createdAt?: Date | string
    updatedAt?: Date | string
    metadata?: string | null
    useCount?: number
    avgLatency?: number | null
    successRate?: number | null
    publishedAt?: Date | string | null
  }

  export type agent_promptsUncheckedCreateInput = {
    id: string
    agentId: string
    version: number
    name: string
    description?: string | null
    systemPrompt: string
    compiledSystemPrompt?: string | null
    compileStatus?: string | null
    compileError?: string | null
    sourceHash?: string | null
    compileContextHash?: string | null
    compiledAt?: Date | string | null
    temperature?: number | null
    maxTokens?: number | null
    model?: string | null
    status?: string
    createdBy: string
    createdAt?: Date | string
    updatedAt?: Date | string
    metadata?: string | null
    useCount?: number
    avgLatency?: number | null
    successRate?: number | null
    publishedAt?: Date | string | null
  }

  export type agent_promptsUpdateInput = {
    id?: StringFieldUpdateOperationsInput | string
    agentId?: StringFieldUpdateOperationsInput | string
    version?: IntFieldUpdateOperationsInput | number
    name?: StringFieldUpdateOperationsInput | string
    description?: NullableStringFieldUpdateOperationsInput | string | null
    systemPrompt?: StringFieldUpdateOperationsInput | string
    compiledSystemPrompt?: NullableStringFieldUpdateOperationsInput | string | null
    compileStatus?: NullableStringFieldUpdateOperationsInput | string | null
    compileError?: NullableStringFieldUpdateOperationsInput | string | null
    sourceHash?: NullableStringFieldUpdateOperationsInput | string | null
    compileContextHash?: NullableStringFieldUpdateOperationsInput | string | null
    compiledAt?: NullableDateTimeFieldUpdateOperationsInput | Date | string | null
    temperature?: NullableFloatFieldUpdateOperationsInput | number | null
    maxTokens?: NullableIntFieldUpdateOperationsInput | number | null
    model?: NullableStringFieldUpdateOperationsInput | string | null
    status?: StringFieldUpdateOperationsInput | string
    createdBy?: StringFieldUpdateOperationsInput | string
    createdAt?: DateTimeFieldUpdateOperationsInput | Date | string
    updatedAt?: DateTimeFieldUpdateOperationsInput | Date | string
    metadata?: NullableStringFieldUpdateOperationsInput | string | null
    useCount?: IntFieldUpdateOperationsInput | number
    avgLatency?: NullableFloatFieldUpdateOperationsInput | number | null
    successRate?: NullableFloatFieldUpdateOperationsInput | number | null
    publishedAt?: NullableDateTimeFieldUpdateOperationsInput | Date | string | null
  }

  export type agent_promptsUncheckedUpdateInput = {
    id?: StringFieldUpdateOperationsInput | string
    agentId?: StringFieldUpdateOperationsInput | string
    version?: IntFieldUpdateOperationsInput | number
    name?: StringFieldUpdateOperationsInput | string
    description?: NullableStringFieldUpdateOperationsInput | string | null
    systemPrompt?: StringFieldUpdateOperationsInput | string
    compiledSystemPrompt?: NullableStringFieldUpdateOperationsInput | string | null
    compileStatus?: NullableStringFieldUpdateOperationsInput | string | null
    compileError?: NullableStringFieldUpdateOperationsInput | string | null
    sourceHash?: NullableStringFieldUpdateOperationsInput | string | null
    compileContextHash?: NullableStringFieldUpdateOperationsInput | string | null
    compiledAt?: NullableDateTimeFieldUpdateOperationsInput | Date | string | null
    temperature?: NullableFloatFieldUpdateOperationsInput | number | null
    maxTokens?: NullableIntFieldUpdateOperationsInput | number | null
    model?: NullableStringFieldUpdateOperationsInput | string | null
    status?: StringFieldUpdateOperationsInput | string
    createdBy?: StringFieldUpdateOperationsInput | string
    createdAt?: DateTimeFieldUpdateOperationsInput | Date | string
    updatedAt?: DateTimeFieldUpdateOperationsInput | Date | string
    metadata?: NullableStringFieldUpdateOperationsInput | string | null
    useCount?: IntFieldUpdateOperationsInput | number
    avgLatency?: NullableFloatFieldUpdateOperationsInput | number | null
    successRate?: NullableFloatFieldUpdateOperationsInput | number | null
    publishedAt?: NullableDateTimeFieldUpdateOperationsInput | Date | string | null
  }

  export type agent_promptsCreateManyInput = {
    id: string
    agentId: string
    version: number
    name: string
    description?: string | null
    systemPrompt: string
    compiledSystemPrompt?: string | null
    compileStatus?: string | null
    compileError?: string | null
    sourceHash?: string | null
    compileContextHash?: string | null
    compiledAt?: Date | string | null
    temperature?: number | null
    maxTokens?: number | null
    model?: string | null
    status?: string
    createdBy: string
    createdAt?: Date | string
    updatedAt?: Date | string
    metadata?: string | null
    useCount?: number
    avgLatency?: number | null
    successRate?: number | null
    publishedAt?: Date | string | null
  }

  export type agent_promptsUpdateManyMutationInput = {
    id?: StringFieldUpdateOperationsInput | string
    agentId?: StringFieldUpdateOperationsInput | string
    version?: IntFieldUpdateOperationsInput | number
    name?: StringFieldUpdateOperationsInput | string
    description?: NullableStringFieldUpdateOperationsInput | string | null
    systemPrompt?: StringFieldUpdateOperationsInput | string
    compiledSystemPrompt?: NullableStringFieldUpdateOperationsInput | string | null
    compileStatus?: NullableStringFieldUpdateOperationsInput | string | null
    compileError?: NullableStringFieldUpdateOperationsInput | string | null
    sourceHash?: NullableStringFieldUpdateOperationsInput | string | null
    compileContextHash?: NullableStringFieldUpdateOperationsInput | string | null
    compiledAt?: NullableDateTimeFieldUpdateOperationsInput | Date | string | null
    temperature?: NullableFloatFieldUpdateOperationsInput | number | null
    maxTokens?: NullableIntFieldUpdateOperationsInput | number | null
    model?: NullableStringFieldUpdateOperationsInput | string | null
    status?: StringFieldUpdateOperationsInput | string
    createdBy?: StringFieldUpdateOperationsInput | string
    createdAt?: DateTimeFieldUpdateOperationsInput | Date | string
    updatedAt?: DateTimeFieldUpdateOperationsInput | Date | string
    metadata?: NullableStringFieldUpdateOperationsInput | string | null
    useCount?: IntFieldUpdateOperationsInput | number
    avgLatency?: NullableFloatFieldUpdateOperationsInput | number | null
    successRate?: NullableFloatFieldUpdateOperationsInput | number | null
    publishedAt?: NullableDateTimeFieldUpdateOperationsInput | Date | string | null
  }

  export type agent_promptsUncheckedUpdateManyInput = {
    id?: StringFieldUpdateOperationsInput | string
    agentId?: StringFieldUpdateOperationsInput | string
    version?: IntFieldUpdateOperationsInput | number
    name?: StringFieldUpdateOperationsInput | string
    description?: NullableStringFieldUpdateOperationsInput | string | null
    systemPrompt?: StringFieldUpdateOperationsInput | string
    compiledSystemPrompt?: NullableStringFieldUpdateOperationsInput | string | null
    compileStatus?: NullableStringFieldUpdateOperationsInput | string | null
    compileError?: NullableStringFieldUpdateOperationsInput | string | null
    sourceHash?: NullableStringFieldUpdateOperationsInput | string | null
    compileContextHash?: NullableStringFieldUpdateOperationsInput | string | null
    compiledAt?: NullableDateTimeFieldUpdateOperationsInput | Date | string | null
    temperature?: NullableFloatFieldUpdateOperationsInput | number | null
    maxTokens?: NullableIntFieldUpdateOperationsInput | number | null
    model?: NullableStringFieldUpdateOperationsInput | string | null
    status?: StringFieldUpdateOperationsInput | string
    createdBy?: StringFieldUpdateOperationsInput | string
    createdAt?: DateTimeFieldUpdateOperationsInput | Date | string
    updatedAt?: DateTimeFieldUpdateOperationsInput | Date | string
    metadata?: NullableStringFieldUpdateOperationsInput | string | null
    useCount?: IntFieldUpdateOperationsInput | number
    avgLatency?: NullableFloatFieldUpdateOperationsInput | number | null
    successRate?: NullableFloatFieldUpdateOperationsInput | number | null
    publishedAt?: NullableDateTimeFieldUpdateOperationsInput | Date | string | null
  }

  export type agent_definitionsCreateInput = {
    id: string
    displayName: string
    description?: string | null
    category: string
    inputSchema?: string | null
    outputSchema?: string | null
    variableBindings?: string | null
    capabilities?: string | null
    defaultMaxTokens?: number | null
    defaultTemperature?: number | null
    schemaVersion?: number
    source?: string
    managedByCode?: boolean
    createdAt?: Date | string
    updatedAt?: Date | string
  }

  export type agent_definitionsUncheckedCreateInput = {
    id: string
    displayName: string
    description?: string | null
    category: string
    inputSchema?: string | null
    outputSchema?: string | null
    variableBindings?: string | null
    capabilities?: string | null
    defaultMaxTokens?: number | null
    defaultTemperature?: number | null
    schemaVersion?: number
    source?: string
    managedByCode?: boolean
    createdAt?: Date | string
    updatedAt?: Date | string
  }

  export type agent_definitionsUpdateInput = {
    id?: StringFieldUpdateOperationsInput | string
    displayName?: StringFieldUpdateOperationsInput | string
    description?: NullableStringFieldUpdateOperationsInput | string | null
    category?: StringFieldUpdateOperationsInput | string
    inputSchema?: NullableStringFieldUpdateOperationsInput | string | null
    outputSchema?: NullableStringFieldUpdateOperationsInput | string | null
    variableBindings?: NullableStringFieldUpdateOperationsInput | string | null
    capabilities?: NullableStringFieldUpdateOperationsInput | string | null
    defaultMaxTokens?: NullableIntFieldUpdateOperationsInput | number | null
    defaultTemperature?: NullableFloatFieldUpdateOperationsInput | number | null
    schemaVersion?: IntFieldUpdateOperationsInput | number
    source?: StringFieldUpdateOperationsInput | string
    managedByCode?: BoolFieldUpdateOperationsInput | boolean
    createdAt?: DateTimeFieldUpdateOperationsInput | Date | string
    updatedAt?: DateTimeFieldUpdateOperationsInput | Date | string
  }

  export type agent_definitionsUncheckedUpdateInput = {
    id?: StringFieldUpdateOperationsInput | string
    displayName?: StringFieldUpdateOperationsInput | string
    description?: NullableStringFieldUpdateOperationsInput | string | null
    category?: StringFieldUpdateOperationsInput | string
    inputSchema?: NullableStringFieldUpdateOperationsInput | string | null
    outputSchema?: NullableStringFieldUpdateOperationsInput | string | null
    variableBindings?: NullableStringFieldUpdateOperationsInput | string | null
    capabilities?: NullableStringFieldUpdateOperationsInput | string | null
    defaultMaxTokens?: NullableIntFieldUpdateOperationsInput | number | null
    defaultTemperature?: NullableFloatFieldUpdateOperationsInput | number | null
    schemaVersion?: IntFieldUpdateOperationsInput | number
    source?: StringFieldUpdateOperationsInput | string
    managedByCode?: BoolFieldUpdateOperationsInput | boolean
    createdAt?: DateTimeFieldUpdateOperationsInput | Date | string
    updatedAt?: DateTimeFieldUpdateOperationsInput | Date | string
  }

  export type agent_definitionsCreateManyInput = {
    id: string
    displayName: string
    description?: string | null
    category: string
    inputSchema?: string | null
    outputSchema?: string | null
    variableBindings?: string | null
    capabilities?: string | null
    defaultMaxTokens?: number | null
    defaultTemperature?: number | null
    schemaVersion?: number
    source?: string
    managedByCode?: boolean
    createdAt?: Date | string
    updatedAt?: Date | string
  }

  export type agent_definitionsUpdateManyMutationInput = {
    id?: StringFieldUpdateOperationsInput | string
    displayName?: StringFieldUpdateOperationsInput | string
    description?: NullableStringFieldUpdateOperationsInput | string | null
    category?: StringFieldUpdateOperationsInput | string
    inputSchema?: NullableStringFieldUpdateOperationsInput | string | null
    outputSchema?: NullableStringFieldUpdateOperationsInput | string | null
    variableBindings?: NullableStringFieldUpdateOperationsInput | string | null
    capabilities?: NullableStringFieldUpdateOperationsInput | string | null
    defaultMaxTokens?: NullableIntFieldUpdateOperationsInput | number | null
    defaultTemperature?: NullableFloatFieldUpdateOperationsInput | number | null
    schemaVersion?: IntFieldUpdateOperationsInput | number
    source?: StringFieldUpdateOperationsInput | string
    managedByCode?: BoolFieldUpdateOperationsInput | boolean
    createdAt?: DateTimeFieldUpdateOperationsInput | Date | string
    updatedAt?: DateTimeFieldUpdateOperationsInput | Date | string
  }

  export type agent_definitionsUncheckedUpdateManyInput = {
    id?: StringFieldUpdateOperationsInput | string
    displayName?: StringFieldUpdateOperationsInput | string
    description?: NullableStringFieldUpdateOperationsInput | string | null
    category?: StringFieldUpdateOperationsInput | string
    inputSchema?: NullableStringFieldUpdateOperationsInput | string | null
    outputSchema?: NullableStringFieldUpdateOperationsInput | string | null
    variableBindings?: NullableStringFieldUpdateOperationsInput | string | null
    capabilities?: NullableStringFieldUpdateOperationsInput | string | null
    defaultMaxTokens?: NullableIntFieldUpdateOperationsInput | number | null
    defaultTemperature?: NullableFloatFieldUpdateOperationsInput | number | null
    schemaVersion?: IntFieldUpdateOperationsInput | number
    source?: StringFieldUpdateOperationsInput | string
    managedByCode?: BoolFieldUpdateOperationsInput | boolean
    createdAt?: DateTimeFieldUpdateOperationsInput | Date | string
    updatedAt?: DateTimeFieldUpdateOperationsInput | Date | string
  }

  export type orchestrator_definitionsCreateInput = {
    id: string
    displayName: string
    description?: string | null
    category?: string
    steps: string
    variableGraph?: string | null
    source?: string
    managedByCode?: boolean
    createdAt?: Date | string
    updatedAt?: Date | string
  }

  export type orchestrator_definitionsUncheckedCreateInput = {
    id: string
    displayName: string
    description?: string | null
    category?: string
    steps: string
    variableGraph?: string | null
    source?: string
    managedByCode?: boolean
    createdAt?: Date | string
    updatedAt?: Date | string
  }

  export type orchestrator_definitionsUpdateInput = {
    id?: StringFieldUpdateOperationsInput | string
    displayName?: StringFieldUpdateOperationsInput | string
    description?: NullableStringFieldUpdateOperationsInput | string | null
    category?: StringFieldUpdateOperationsInput | string
    steps?: StringFieldUpdateOperationsInput | string
    variableGraph?: NullableStringFieldUpdateOperationsInput | string | null
    source?: StringFieldUpdateOperationsInput | string
    managedByCode?: BoolFieldUpdateOperationsInput | boolean
    createdAt?: DateTimeFieldUpdateOperationsInput | Date | string
    updatedAt?: DateTimeFieldUpdateOperationsInput | Date | string
  }

  export type orchestrator_definitionsUncheckedUpdateInput = {
    id?: StringFieldUpdateOperationsInput | string
    displayName?: StringFieldUpdateOperationsInput | string
    description?: NullableStringFieldUpdateOperationsInput | string | null
    category?: StringFieldUpdateOperationsInput | string
    steps?: StringFieldUpdateOperationsInput | string
    variableGraph?: NullableStringFieldUpdateOperationsInput | string | null
    source?: StringFieldUpdateOperationsInput | string
    managedByCode?: BoolFieldUpdateOperationsInput | boolean
    createdAt?: DateTimeFieldUpdateOperationsInput | Date | string
    updatedAt?: DateTimeFieldUpdateOperationsInput | Date | string
  }

  export type orchestrator_definitionsCreateManyInput = {
    id: string
    displayName: string
    description?: string | null
    category?: string
    steps: string
    variableGraph?: string | null
    source?: string
    managedByCode?: boolean
    createdAt?: Date | string
    updatedAt?: Date | string
  }

  export type orchestrator_definitionsUpdateManyMutationInput = {
    id?: StringFieldUpdateOperationsInput | string
    displayName?: StringFieldUpdateOperationsInput | string
    description?: NullableStringFieldUpdateOperationsInput | string | null
    category?: StringFieldUpdateOperationsInput | string
    steps?: StringFieldUpdateOperationsInput | string
    variableGraph?: NullableStringFieldUpdateOperationsInput | string | null
    source?: StringFieldUpdateOperationsInput | string
    managedByCode?: BoolFieldUpdateOperationsInput | boolean
    createdAt?: DateTimeFieldUpdateOperationsInput | Date | string
    updatedAt?: DateTimeFieldUpdateOperationsInput | Date | string
  }

  export type orchestrator_definitionsUncheckedUpdateManyInput = {
    id?: StringFieldUpdateOperationsInput | string
    displayName?: StringFieldUpdateOperationsInput | string
    description?: NullableStringFieldUpdateOperationsInput | string | null
    category?: StringFieldUpdateOperationsInput | string
    steps?: StringFieldUpdateOperationsInput | string
    variableGraph?: NullableStringFieldUpdateOperationsInput | string | null
    source?: StringFieldUpdateOperationsInput | string
    managedByCode?: BoolFieldUpdateOperationsInput | boolean
    createdAt?: DateTimeFieldUpdateOperationsInput | Date | string
    updatedAt?: DateTimeFieldUpdateOperationsInput | Date | string
  }

  export type agent_registrationsCreateInput = {
    id: string
    name: string
    type: string
    category?: string | null
    description?: string | null
    version?: string
    config?: string | null
    inputSchema?: string | null
    outputSchema?: string | null
    capabilities?: string | null
    subscribes?: string | null
    publishes?: string | null
    callCount?: number
    successRate?: number
    createdAt?: Date | string
    updatedAt?: Date | string
    endpoint?: string | null
  }

  export type agent_registrationsUncheckedCreateInput = {
    id: string
    name: string
    type: string
    category?: string | null
    description?: string | null
    version?: string
    config?: string | null
    inputSchema?: string | null
    outputSchema?: string | null
    capabilities?: string | null
    subscribes?: string | null
    publishes?: string | null
    callCount?: number
    successRate?: number
    createdAt?: Date | string
    updatedAt?: Date | string
    endpoint?: string | null
  }

  export type agent_registrationsUpdateInput = {
    id?: StringFieldUpdateOperationsInput | string
    name?: StringFieldUpdateOperationsInput | string
    type?: StringFieldUpdateOperationsInput | string
    category?: NullableStringFieldUpdateOperationsInput | string | null
    description?: NullableStringFieldUpdateOperationsInput | string | null
    version?: StringFieldUpdateOperationsInput | string
    config?: NullableStringFieldUpdateOperationsInput | string | null
    inputSchema?: NullableStringFieldUpdateOperationsInput | string | null
    outputSchema?: NullableStringFieldUpdateOperationsInput | string | null
    capabilities?: NullableStringFieldUpdateOperationsInput | string | null
    subscribes?: NullableStringFieldUpdateOperationsInput | string | null
    publishes?: NullableStringFieldUpdateOperationsInput | string | null
    callCount?: IntFieldUpdateOperationsInput | number
    successRate?: FloatFieldUpdateOperationsInput | number
    createdAt?: DateTimeFieldUpdateOperationsInput | Date | string
    updatedAt?: DateTimeFieldUpdateOperationsInput | Date | string
    endpoint?: NullableStringFieldUpdateOperationsInput | string | null
  }

  export type agent_registrationsUncheckedUpdateInput = {
    id?: StringFieldUpdateOperationsInput | string
    name?: StringFieldUpdateOperationsInput | string
    type?: StringFieldUpdateOperationsInput | string
    category?: NullableStringFieldUpdateOperationsInput | string | null
    description?: NullableStringFieldUpdateOperationsInput | string | null
    version?: StringFieldUpdateOperationsInput | string
    config?: NullableStringFieldUpdateOperationsInput | string | null
    inputSchema?: NullableStringFieldUpdateOperationsInput | string | null
    outputSchema?: NullableStringFieldUpdateOperationsInput | string | null
    capabilities?: NullableStringFieldUpdateOperationsInput | string | null
    subscribes?: NullableStringFieldUpdateOperationsInput | string | null
    publishes?: NullableStringFieldUpdateOperationsInput | string | null
    callCount?: IntFieldUpdateOperationsInput | number
    successRate?: FloatFieldUpdateOperationsInput | number
    createdAt?: DateTimeFieldUpdateOperationsInput | Date | string
    updatedAt?: DateTimeFieldUpdateOperationsInput | Date | string
    endpoint?: NullableStringFieldUpdateOperationsInput | string | null
  }

  export type agent_registrationsCreateManyInput = {
    id: string
    name: string
    type: string
    category?: string | null
    description?: string | null
    version?: string
    config?: string | null
    inputSchema?: string | null
    outputSchema?: string | null
    capabilities?: string | null
    subscribes?: string | null
    publishes?: string | null
    callCount?: number
    successRate?: number
    createdAt?: Date | string
    updatedAt?: Date | string
    endpoint?: string | null
  }

  export type agent_registrationsUpdateManyMutationInput = {
    id?: StringFieldUpdateOperationsInput | string
    name?: StringFieldUpdateOperationsInput | string
    type?: StringFieldUpdateOperationsInput | string
    category?: NullableStringFieldUpdateOperationsInput | string | null
    description?: NullableStringFieldUpdateOperationsInput | string | null
    version?: StringFieldUpdateOperationsInput | string
    config?: NullableStringFieldUpdateOperationsInput | string | null
    inputSchema?: NullableStringFieldUpdateOperationsInput | string | null
    outputSchema?: NullableStringFieldUpdateOperationsInput | string | null
    capabilities?: NullableStringFieldUpdateOperationsInput | string | null
    subscribes?: NullableStringFieldUpdateOperationsInput | string | null
    publishes?: NullableStringFieldUpdateOperationsInput | string | null
    callCount?: IntFieldUpdateOperationsInput | number
    successRate?: FloatFieldUpdateOperationsInput | number
    createdAt?: DateTimeFieldUpdateOperationsInput | Date | string
    updatedAt?: DateTimeFieldUpdateOperationsInput | Date | string
    endpoint?: NullableStringFieldUpdateOperationsInput | string | null
  }

  export type agent_registrationsUncheckedUpdateManyInput = {
    id?: StringFieldUpdateOperationsInput | string
    name?: StringFieldUpdateOperationsInput | string
    type?: StringFieldUpdateOperationsInput | string
    category?: NullableStringFieldUpdateOperationsInput | string | null
    description?: NullableStringFieldUpdateOperationsInput | string | null
    version?: StringFieldUpdateOperationsInput | string
    config?: NullableStringFieldUpdateOperationsInput | string | null
    inputSchema?: NullableStringFieldUpdateOperationsInput | string | null
    outputSchema?: NullableStringFieldUpdateOperationsInput | string | null
    capabilities?: NullableStringFieldUpdateOperationsInput | string | null
    subscribes?: NullableStringFieldUpdateOperationsInput | string | null
    publishes?: NullableStringFieldUpdateOperationsInput | string | null
    callCount?: IntFieldUpdateOperationsInput | number
    successRate?: FloatFieldUpdateOperationsInput | number
    createdAt?: DateTimeFieldUpdateOperationsInput | Date | string
    updatedAt?: DateTimeFieldUpdateOperationsInput | Date | string
    endpoint?: NullableStringFieldUpdateOperationsInput | string | null
  }

  export type platform_api_configsCreateInput = {
    id?: string
    apiUrl?: string | null
    apiKey?: string | null
    availableModels?: string | null
    defaultModel?: string | null
    defaultReasoningModel?: string | null
    defaultEvaluationModel?: string | null
    connectionStatus?: string
    lastCheckedAt?: Date | string | null
    createdAt?: Date | string
    updatedAt?: Date | string
    defaultTemperature?: number
    defaultMaxTokens?: number
    reasoningEndpoint?: string | null
    lightEndpoint?: string | null
    chatModels?: string | null
    reasoningModels?: string | null
    lightModels?: string | null
    adminAccessMode?: string | null
    adminAllowedIps?: string | null
    allowPrivateNetwork?: boolean | null
    privateNetworkHosts?: string | null
  }

  export type platform_api_configsUncheckedCreateInput = {
    id?: string
    apiUrl?: string | null
    apiKey?: string | null
    availableModels?: string | null
    defaultModel?: string | null
    defaultReasoningModel?: string | null
    defaultEvaluationModel?: string | null
    connectionStatus?: string
    lastCheckedAt?: Date | string | null
    createdAt?: Date | string
    updatedAt?: Date | string
    defaultTemperature?: number
    defaultMaxTokens?: number
    reasoningEndpoint?: string | null
    lightEndpoint?: string | null
    chatModels?: string | null
    reasoningModels?: string | null
    lightModels?: string | null
    adminAccessMode?: string | null
    adminAllowedIps?: string | null
    allowPrivateNetwork?: boolean | null
    privateNetworkHosts?: string | null
  }

  export type platform_api_configsUpdateInput = {
    id?: StringFieldUpdateOperationsInput | string
    apiUrl?: NullableStringFieldUpdateOperationsInput | string | null
    apiKey?: NullableStringFieldUpdateOperationsInput | string | null
    availableModels?: NullableStringFieldUpdateOperationsInput | string | null
    defaultModel?: NullableStringFieldUpdateOperationsInput | string | null
    defaultReasoningModel?: NullableStringFieldUpdateOperationsInput | string | null
    defaultEvaluationModel?: NullableStringFieldUpdateOperationsInput | string | null
    connectionStatus?: StringFieldUpdateOperationsInput | string
    lastCheckedAt?: NullableDateTimeFieldUpdateOperationsInput | Date | string | null
    createdAt?: DateTimeFieldUpdateOperationsInput | Date | string
    updatedAt?: DateTimeFieldUpdateOperationsInput | Date | string
    defaultTemperature?: FloatFieldUpdateOperationsInput | number
    defaultMaxTokens?: IntFieldUpdateOperationsInput | number
    reasoningEndpoint?: NullableStringFieldUpdateOperationsInput | string | null
    lightEndpoint?: NullableStringFieldUpdateOperationsInput | string | null
    chatModels?: NullableStringFieldUpdateOperationsInput | string | null
    reasoningModels?: NullableStringFieldUpdateOperationsInput | string | null
    lightModels?: NullableStringFieldUpdateOperationsInput | string | null
    adminAccessMode?: NullableStringFieldUpdateOperationsInput | string | null
    adminAllowedIps?: NullableStringFieldUpdateOperationsInput | string | null
    allowPrivateNetwork?: NullableBoolFieldUpdateOperationsInput | boolean | null
    privateNetworkHosts?: NullableStringFieldUpdateOperationsInput | string | null
  }

  export type platform_api_configsUncheckedUpdateInput = {
    id?: StringFieldUpdateOperationsInput | string
    apiUrl?: NullableStringFieldUpdateOperationsInput | string | null
    apiKey?: NullableStringFieldUpdateOperationsInput | string | null
    availableModels?: NullableStringFieldUpdateOperationsInput | string | null
    defaultModel?: NullableStringFieldUpdateOperationsInput | string | null
    defaultReasoningModel?: NullableStringFieldUpdateOperationsInput | string | null
    defaultEvaluationModel?: NullableStringFieldUpdateOperationsInput | string | null
    connectionStatus?: StringFieldUpdateOperationsInput | string
    lastCheckedAt?: NullableDateTimeFieldUpdateOperationsInput | Date | string | null
    createdAt?: DateTimeFieldUpdateOperationsInput | Date | string
    updatedAt?: DateTimeFieldUpdateOperationsInput | Date | string
    defaultTemperature?: FloatFieldUpdateOperationsInput | number
    defaultMaxTokens?: IntFieldUpdateOperationsInput | number
    reasoningEndpoint?: NullableStringFieldUpdateOperationsInput | string | null
    lightEndpoint?: NullableStringFieldUpdateOperationsInput | string | null
    chatModels?: NullableStringFieldUpdateOperationsInput | string | null
    reasoningModels?: NullableStringFieldUpdateOperationsInput | string | null
    lightModels?: NullableStringFieldUpdateOperationsInput | string | null
    adminAccessMode?: NullableStringFieldUpdateOperationsInput | string | null
    adminAllowedIps?: NullableStringFieldUpdateOperationsInput | string | null
    allowPrivateNetwork?: NullableBoolFieldUpdateOperationsInput | boolean | null
    privateNetworkHosts?: NullableStringFieldUpdateOperationsInput | string | null
  }

  export type platform_api_configsCreateManyInput = {
    id?: string
    apiUrl?: string | null
    apiKey?: string | null
    availableModels?: string | null
    defaultModel?: string | null
    defaultReasoningModel?: string | null
    defaultEvaluationModel?: string | null
    connectionStatus?: string
    lastCheckedAt?: Date | string | null
    createdAt?: Date | string
    updatedAt?: Date | string
    defaultTemperature?: number
    defaultMaxTokens?: number
    reasoningEndpoint?: string | null
    lightEndpoint?: string | null
    chatModels?: string | null
    reasoningModels?: string | null
    lightModels?: string | null
    adminAccessMode?: string | null
    adminAllowedIps?: string | null
    allowPrivateNetwork?: boolean | null
    privateNetworkHosts?: string | null
  }

  export type platform_api_configsUpdateManyMutationInput = {
    id?: StringFieldUpdateOperationsInput | string
    apiUrl?: NullableStringFieldUpdateOperationsInput | string | null
    apiKey?: NullableStringFieldUpdateOperationsInput | string | null
    availableModels?: NullableStringFieldUpdateOperationsInput | string | null
    defaultModel?: NullableStringFieldUpdateOperationsInput | string | null
    defaultReasoningModel?: NullableStringFieldUpdateOperationsInput | string | null
    defaultEvaluationModel?: NullableStringFieldUpdateOperationsInput | string | null
    connectionStatus?: StringFieldUpdateOperationsInput | string
    lastCheckedAt?: NullableDateTimeFieldUpdateOperationsInput | Date | string | null
    createdAt?: DateTimeFieldUpdateOperationsInput | Date | string
    updatedAt?: DateTimeFieldUpdateOperationsInput | Date | string
    defaultTemperature?: FloatFieldUpdateOperationsInput | number
    defaultMaxTokens?: IntFieldUpdateOperationsInput | number
    reasoningEndpoint?: NullableStringFieldUpdateOperationsInput | string | null
    lightEndpoint?: NullableStringFieldUpdateOperationsInput | string | null
    chatModels?: NullableStringFieldUpdateOperationsInput | string | null
    reasoningModels?: NullableStringFieldUpdateOperationsInput | string | null
    lightModels?: NullableStringFieldUpdateOperationsInput | string | null
    adminAccessMode?: NullableStringFieldUpdateOperationsInput | string | null
    adminAllowedIps?: NullableStringFieldUpdateOperationsInput | string | null
    allowPrivateNetwork?: NullableBoolFieldUpdateOperationsInput | boolean | null
    privateNetworkHosts?: NullableStringFieldUpdateOperationsInput | string | null
  }

  export type platform_api_configsUncheckedUpdateManyInput = {
    id?: StringFieldUpdateOperationsInput | string
    apiUrl?: NullableStringFieldUpdateOperationsInput | string | null
    apiKey?: NullableStringFieldUpdateOperationsInput | string | null
    availableModels?: NullableStringFieldUpdateOperationsInput | string | null
    defaultModel?: NullableStringFieldUpdateOperationsInput | string | null
    defaultReasoningModel?: NullableStringFieldUpdateOperationsInput | string | null
    defaultEvaluationModel?: NullableStringFieldUpdateOperationsInput | string | null
    connectionStatus?: StringFieldUpdateOperationsInput | string
    lastCheckedAt?: NullableDateTimeFieldUpdateOperationsInput | Date | string | null
    createdAt?: DateTimeFieldUpdateOperationsInput | Date | string
    updatedAt?: DateTimeFieldUpdateOperationsInput | Date | string
    defaultTemperature?: FloatFieldUpdateOperationsInput | number
    defaultMaxTokens?: IntFieldUpdateOperationsInput | number
    reasoningEndpoint?: NullableStringFieldUpdateOperationsInput | string | null
    lightEndpoint?: NullableStringFieldUpdateOperationsInput | string | null
    chatModels?: NullableStringFieldUpdateOperationsInput | string | null
    reasoningModels?: NullableStringFieldUpdateOperationsInput | string | null
    lightModels?: NullableStringFieldUpdateOperationsInput | string | null
    adminAccessMode?: NullableStringFieldUpdateOperationsInput | string | null
    adminAllowedIps?: NullableStringFieldUpdateOperationsInput | string | null
    allowPrivateNetwork?: NullableBoolFieldUpdateOperationsInput | boolean | null
    privateNetworkHosts?: NullableStringFieldUpdateOperationsInput | string | null
  }

  export type platform_settingsCreateInput = {
    key: string
    value: string
    createdAt?: Date | string
    updatedAt?: Date | string
  }

  export type platform_settingsUncheckedCreateInput = {
    key: string
    value: string
    createdAt?: Date | string
    updatedAt?: Date | string
  }

  export type platform_settingsUpdateInput = {
    key?: StringFieldUpdateOperationsInput | string
    value?: StringFieldUpdateOperationsInput | string
    createdAt?: DateTimeFieldUpdateOperationsInput | Date | string
    updatedAt?: DateTimeFieldUpdateOperationsInput | Date | string
  }

  export type platform_settingsUncheckedUpdateInput = {
    key?: StringFieldUpdateOperationsInput | string
    value?: StringFieldUpdateOperationsInput | string
    createdAt?: DateTimeFieldUpdateOperationsInput | Date | string
    updatedAt?: DateTimeFieldUpdateOperationsInput | Date | string
  }

  export type platform_settingsCreateManyInput = {
    key: string
    value: string
    createdAt?: Date | string
    updatedAt?: Date | string
  }

  export type platform_settingsUpdateManyMutationInput = {
    key?: StringFieldUpdateOperationsInput | string
    value?: StringFieldUpdateOperationsInput | string
    createdAt?: DateTimeFieldUpdateOperationsInput | Date | string
    updatedAt?: DateTimeFieldUpdateOperationsInput | Date | string
  }

  export type platform_settingsUncheckedUpdateManyInput = {
    key?: StringFieldUpdateOperationsInput | string
    value?: StringFieldUpdateOperationsInput | string
    createdAt?: DateTimeFieldUpdateOperationsInput | Date | string
    updatedAt?: DateTimeFieldUpdateOperationsInput | Date | string
  }

  export type skill_model_configsCreateInput = {
    id: string
    skillId: string
    tier?: string
    model?: string | null
    thinkingMode?: string | null
    reasoningEffort?: string | null
    endpoint?: string | null
    apiKey?: string | null
    temperature?: number
    maxTokens?: number
    requestTimeoutMs?: number | null
    enabled?: boolean
    createdAt?: Date | string
    updatedAt: Date | string
  }

  export type skill_model_configsUncheckedCreateInput = {
    id: string
    skillId: string
    tier?: string
    model?: string | null
    thinkingMode?: string | null
    reasoningEffort?: string | null
    endpoint?: string | null
    apiKey?: string | null
    temperature?: number
    maxTokens?: number
    requestTimeoutMs?: number | null
    enabled?: boolean
    createdAt?: Date | string
    updatedAt: Date | string
  }

  export type skill_model_configsUpdateInput = {
    id?: StringFieldUpdateOperationsInput | string
    skillId?: StringFieldUpdateOperationsInput | string
    tier?: StringFieldUpdateOperationsInput | string
    model?: NullableStringFieldUpdateOperationsInput | string | null
    thinkingMode?: NullableStringFieldUpdateOperationsInput | string | null
    reasoningEffort?: NullableStringFieldUpdateOperationsInput | string | null
    endpoint?: NullableStringFieldUpdateOperationsInput | string | null
    apiKey?: NullableStringFieldUpdateOperationsInput | string | null
    temperature?: FloatFieldUpdateOperationsInput | number
    maxTokens?: IntFieldUpdateOperationsInput | number
    requestTimeoutMs?: NullableIntFieldUpdateOperationsInput | number | null
    enabled?: BoolFieldUpdateOperationsInput | boolean
    createdAt?: DateTimeFieldUpdateOperationsInput | Date | string
    updatedAt?: DateTimeFieldUpdateOperationsInput | Date | string
  }

  export type skill_model_configsUncheckedUpdateInput = {
    id?: StringFieldUpdateOperationsInput | string
    skillId?: StringFieldUpdateOperationsInput | string
    tier?: StringFieldUpdateOperationsInput | string
    model?: NullableStringFieldUpdateOperationsInput | string | null
    thinkingMode?: NullableStringFieldUpdateOperationsInput | string | null
    reasoningEffort?: NullableStringFieldUpdateOperationsInput | string | null
    endpoint?: NullableStringFieldUpdateOperationsInput | string | null
    apiKey?: NullableStringFieldUpdateOperationsInput | string | null
    temperature?: FloatFieldUpdateOperationsInput | number
    maxTokens?: IntFieldUpdateOperationsInput | number
    requestTimeoutMs?: NullableIntFieldUpdateOperationsInput | number | null
    enabled?: BoolFieldUpdateOperationsInput | boolean
    createdAt?: DateTimeFieldUpdateOperationsInput | Date | string
    updatedAt?: DateTimeFieldUpdateOperationsInput | Date | string
  }

  export type skill_model_configsCreateManyInput = {
    id: string
    skillId: string
    tier?: string
    model?: string | null
    thinkingMode?: string | null
    reasoningEffort?: string | null
    endpoint?: string | null
    apiKey?: string | null
    temperature?: number
    maxTokens?: number
    requestTimeoutMs?: number | null
    enabled?: boolean
    createdAt?: Date | string
    updatedAt: Date | string
  }

  export type skill_model_configsUpdateManyMutationInput = {
    id?: StringFieldUpdateOperationsInput | string
    skillId?: StringFieldUpdateOperationsInput | string
    tier?: StringFieldUpdateOperationsInput | string
    model?: NullableStringFieldUpdateOperationsInput | string | null
    thinkingMode?: NullableStringFieldUpdateOperationsInput | string | null
    reasoningEffort?: NullableStringFieldUpdateOperationsInput | string | null
    endpoint?: NullableStringFieldUpdateOperationsInput | string | null
    apiKey?: NullableStringFieldUpdateOperationsInput | string | null
    temperature?: FloatFieldUpdateOperationsInput | number
    maxTokens?: IntFieldUpdateOperationsInput | number
    requestTimeoutMs?: NullableIntFieldUpdateOperationsInput | number | null
    enabled?: BoolFieldUpdateOperationsInput | boolean
    createdAt?: DateTimeFieldUpdateOperationsInput | Date | string
    updatedAt?: DateTimeFieldUpdateOperationsInput | Date | string
  }

  export type skill_model_configsUncheckedUpdateManyInput = {
    id?: StringFieldUpdateOperationsInput | string
    skillId?: StringFieldUpdateOperationsInput | string
    tier?: StringFieldUpdateOperationsInput | string
    model?: NullableStringFieldUpdateOperationsInput | string | null
    thinkingMode?: NullableStringFieldUpdateOperationsInput | string | null
    reasoningEffort?: NullableStringFieldUpdateOperationsInput | string | null
    endpoint?: NullableStringFieldUpdateOperationsInput | string | null
    apiKey?: NullableStringFieldUpdateOperationsInput | string | null
    temperature?: FloatFieldUpdateOperationsInput | number
    maxTokens?: IntFieldUpdateOperationsInput | number
    requestTimeoutMs?: NullableIntFieldUpdateOperationsInput | number | null
    enabled?: BoolFieldUpdateOperationsInput | boolean
    createdAt?: DateTimeFieldUpdateOperationsInput | Date | string
    updatedAt?: DateTimeFieldUpdateOperationsInput | Date | string
  }

  export type skill_registrationsCreateInput = {
    id: string
    name: string
    version?: string
    category?: string | null
    description?: string | null
    inputSchema?: string | null
    outputSchema?: string | null
    endpoint?: string | null
    callCount?: number
    successRate?: number
    createdAt?: Date | string
    updatedAt?: Date | string
  }

  export type skill_registrationsUncheckedCreateInput = {
    id: string
    name: string
    version?: string
    category?: string | null
    description?: string | null
    inputSchema?: string | null
    outputSchema?: string | null
    endpoint?: string | null
    callCount?: number
    successRate?: number
    createdAt?: Date | string
    updatedAt?: Date | string
  }

  export type skill_registrationsUpdateInput = {
    id?: StringFieldUpdateOperationsInput | string
    name?: StringFieldUpdateOperationsInput | string
    version?: StringFieldUpdateOperationsInput | string
    category?: NullableStringFieldUpdateOperationsInput | string | null
    description?: NullableStringFieldUpdateOperationsInput | string | null
    inputSchema?: NullableStringFieldUpdateOperationsInput | string | null
    outputSchema?: NullableStringFieldUpdateOperationsInput | string | null
    endpoint?: NullableStringFieldUpdateOperationsInput | string | null
    callCount?: IntFieldUpdateOperationsInput | number
    successRate?: FloatFieldUpdateOperationsInput | number
    createdAt?: DateTimeFieldUpdateOperationsInput | Date | string
    updatedAt?: DateTimeFieldUpdateOperationsInput | Date | string
  }

  export type skill_registrationsUncheckedUpdateInput = {
    id?: StringFieldUpdateOperationsInput | string
    name?: StringFieldUpdateOperationsInput | string
    version?: StringFieldUpdateOperationsInput | string
    category?: NullableStringFieldUpdateOperationsInput | string | null
    description?: NullableStringFieldUpdateOperationsInput | string | null
    inputSchema?: NullableStringFieldUpdateOperationsInput | string | null
    outputSchema?: NullableStringFieldUpdateOperationsInput | string | null
    endpoint?: NullableStringFieldUpdateOperationsInput | string | null
    callCount?: IntFieldUpdateOperationsInput | number
    successRate?: FloatFieldUpdateOperationsInput | number
    createdAt?: DateTimeFieldUpdateOperationsInput | Date | string
    updatedAt?: DateTimeFieldUpdateOperationsInput | Date | string
  }

  export type skill_registrationsCreateManyInput = {
    id: string
    name: string
    version?: string
    category?: string | null
    description?: string | null
    inputSchema?: string | null
    outputSchema?: string | null
    endpoint?: string | null
    callCount?: number
    successRate?: number
    createdAt?: Date | string
    updatedAt?: Date | string
  }

  export type skill_registrationsUpdateManyMutationInput = {
    id?: StringFieldUpdateOperationsInput | string
    name?: StringFieldUpdateOperationsInput | string
    version?: StringFieldUpdateOperationsInput | string
    category?: NullableStringFieldUpdateOperationsInput | string | null
    description?: NullableStringFieldUpdateOperationsInput | string | null
    inputSchema?: NullableStringFieldUpdateOperationsInput | string | null
    outputSchema?: NullableStringFieldUpdateOperationsInput | string | null
    endpoint?: NullableStringFieldUpdateOperationsInput | string | null
    callCount?: IntFieldUpdateOperationsInput | number
    successRate?: FloatFieldUpdateOperationsInput | number
    createdAt?: DateTimeFieldUpdateOperationsInput | Date | string
    updatedAt?: DateTimeFieldUpdateOperationsInput | Date | string
  }

  export type skill_registrationsUncheckedUpdateManyInput = {
    id?: StringFieldUpdateOperationsInput | string
    name?: StringFieldUpdateOperationsInput | string
    version?: StringFieldUpdateOperationsInput | string
    category?: NullableStringFieldUpdateOperationsInput | string | null
    description?: NullableStringFieldUpdateOperationsInput | string | null
    inputSchema?: NullableStringFieldUpdateOperationsInput | string | null
    outputSchema?: NullableStringFieldUpdateOperationsInput | string | null
    endpoint?: NullableStringFieldUpdateOperationsInput | string | null
    callCount?: IntFieldUpdateOperationsInput | number
    successRate?: FloatFieldUpdateOperationsInput | number
    createdAt?: DateTimeFieldUpdateOperationsInput | Date | string
    updatedAt?: DateTimeFieldUpdateOperationsInput | Date | string
  }

  export type field_definitionsCreateInput = {
    id: string
    fieldId: string
    stage: string
    promptRole: string
    valueType?: string
    snakeName?: string | null
    camelName?: string | null
    description?: string | null
    enumValues?: string | null
    schemaVersion?: string
    source?: string
    managedByCode?: boolean
    systemLocked?: boolean
    structureLocked?: boolean
    bindings?: string | null
    metadata?: string | null
    createdAt?: Date | string
    updatedAt?: Date | string
  }

  export type field_definitionsUncheckedCreateInput = {
    id: string
    fieldId: string
    stage: string
    promptRole: string
    valueType?: string
    snakeName?: string | null
    camelName?: string | null
    description?: string | null
    enumValues?: string | null
    schemaVersion?: string
    source?: string
    managedByCode?: boolean
    systemLocked?: boolean
    structureLocked?: boolean
    bindings?: string | null
    metadata?: string | null
    createdAt?: Date | string
    updatedAt?: Date | string
  }

  export type field_definitionsUpdateInput = {
    id?: StringFieldUpdateOperationsInput | string
    fieldId?: StringFieldUpdateOperationsInput | string
    stage?: StringFieldUpdateOperationsInput | string
    promptRole?: StringFieldUpdateOperationsInput | string
    valueType?: StringFieldUpdateOperationsInput | string
    snakeName?: NullableStringFieldUpdateOperationsInput | string | null
    camelName?: NullableStringFieldUpdateOperationsInput | string | null
    description?: NullableStringFieldUpdateOperationsInput | string | null
    enumValues?: NullableStringFieldUpdateOperationsInput | string | null
    schemaVersion?: StringFieldUpdateOperationsInput | string
    source?: StringFieldUpdateOperationsInput | string
    managedByCode?: BoolFieldUpdateOperationsInput | boolean
    systemLocked?: BoolFieldUpdateOperationsInput | boolean
    structureLocked?: BoolFieldUpdateOperationsInput | boolean
    bindings?: NullableStringFieldUpdateOperationsInput | string | null
    metadata?: NullableStringFieldUpdateOperationsInput | string | null
    createdAt?: DateTimeFieldUpdateOperationsInput | Date | string
    updatedAt?: DateTimeFieldUpdateOperationsInput | Date | string
  }

  export type field_definitionsUncheckedUpdateInput = {
    id?: StringFieldUpdateOperationsInput | string
    fieldId?: StringFieldUpdateOperationsInput | string
    stage?: StringFieldUpdateOperationsInput | string
    promptRole?: StringFieldUpdateOperationsInput | string
    valueType?: StringFieldUpdateOperationsInput | string
    snakeName?: NullableStringFieldUpdateOperationsInput | string | null
    camelName?: NullableStringFieldUpdateOperationsInput | string | null
    description?: NullableStringFieldUpdateOperationsInput | string | null
    enumValues?: NullableStringFieldUpdateOperationsInput | string | null
    schemaVersion?: StringFieldUpdateOperationsInput | string
    source?: StringFieldUpdateOperationsInput | string
    managedByCode?: BoolFieldUpdateOperationsInput | boolean
    systemLocked?: BoolFieldUpdateOperationsInput | boolean
    structureLocked?: BoolFieldUpdateOperationsInput | boolean
    bindings?: NullableStringFieldUpdateOperationsInput | string | null
    metadata?: NullableStringFieldUpdateOperationsInput | string | null
    createdAt?: DateTimeFieldUpdateOperationsInput | Date | string
    updatedAt?: DateTimeFieldUpdateOperationsInput | Date | string
  }

  export type field_definitionsCreateManyInput = {
    id: string
    fieldId: string
    stage: string
    promptRole: string
    valueType?: string
    snakeName?: string | null
    camelName?: string | null
    description?: string | null
    enumValues?: string | null
    schemaVersion?: string
    source?: string
    managedByCode?: boolean
    systemLocked?: boolean
    structureLocked?: boolean
    bindings?: string | null
    metadata?: string | null
    createdAt?: Date | string
    updatedAt?: Date | string
  }

  export type field_definitionsUpdateManyMutationInput = {
    id?: StringFieldUpdateOperationsInput | string
    fieldId?: StringFieldUpdateOperationsInput | string
    stage?: StringFieldUpdateOperationsInput | string
    promptRole?: StringFieldUpdateOperationsInput | string
    valueType?: StringFieldUpdateOperationsInput | string
    snakeName?: NullableStringFieldUpdateOperationsInput | string | null
    camelName?: NullableStringFieldUpdateOperationsInput | string | null
    description?: NullableStringFieldUpdateOperationsInput | string | null
    enumValues?: NullableStringFieldUpdateOperationsInput | string | null
    schemaVersion?: StringFieldUpdateOperationsInput | string
    source?: StringFieldUpdateOperationsInput | string
    managedByCode?: BoolFieldUpdateOperationsInput | boolean
    systemLocked?: BoolFieldUpdateOperationsInput | boolean
    structureLocked?: BoolFieldUpdateOperationsInput | boolean
    bindings?: NullableStringFieldUpdateOperationsInput | string | null
    metadata?: NullableStringFieldUpdateOperationsInput | string | null
    createdAt?: DateTimeFieldUpdateOperationsInput | Date | string
    updatedAt?: DateTimeFieldUpdateOperationsInput | Date | string
  }

  export type field_definitionsUncheckedUpdateManyInput = {
    id?: StringFieldUpdateOperationsInput | string
    fieldId?: StringFieldUpdateOperationsInput | string
    stage?: StringFieldUpdateOperationsInput | string
    promptRole?: StringFieldUpdateOperationsInput | string
    valueType?: StringFieldUpdateOperationsInput | string
    snakeName?: NullableStringFieldUpdateOperationsInput | string | null
    camelName?: NullableStringFieldUpdateOperationsInput | string | null
    description?: NullableStringFieldUpdateOperationsInput | string | null
    enumValues?: NullableStringFieldUpdateOperationsInput | string | null
    schemaVersion?: StringFieldUpdateOperationsInput | string
    source?: StringFieldUpdateOperationsInput | string
    managedByCode?: BoolFieldUpdateOperationsInput | boolean
    systemLocked?: BoolFieldUpdateOperationsInput | boolean
    structureLocked?: BoolFieldUpdateOperationsInput | boolean
    bindings?: NullableStringFieldUpdateOperationsInput | string | null
    metadata?: NullableStringFieldUpdateOperationsInput | string | null
    createdAt?: DateTimeFieldUpdateOperationsInput | Date | string
    updatedAt?: DateTimeFieldUpdateOperationsInput | Date | string
  }

  export type agent_contractsCreateInput = {
    id: string
    agentId: string
    stage: string
    displayName: string
    description?: string | null
    schemaVersion?: string
    source?: string
    managedByCode?: boolean
    metadata?: string | null
    createdAt?: Date | string
    updatedAt?: Date | string
  }

  export type agent_contractsUncheckedCreateInput = {
    id: string
    agentId: string
    stage: string
    displayName: string
    description?: string | null
    schemaVersion?: string
    source?: string
    managedByCode?: boolean
    metadata?: string | null
    createdAt?: Date | string
    updatedAt?: Date | string
  }

  export type agent_contractsUpdateInput = {
    id?: StringFieldUpdateOperationsInput | string
    agentId?: StringFieldUpdateOperationsInput | string
    stage?: StringFieldUpdateOperationsInput | string
    displayName?: StringFieldUpdateOperationsInput | string
    description?: NullableStringFieldUpdateOperationsInput | string | null
    schemaVersion?: StringFieldUpdateOperationsInput | string
    source?: StringFieldUpdateOperationsInput | string
    managedByCode?: BoolFieldUpdateOperationsInput | boolean
    metadata?: NullableStringFieldUpdateOperationsInput | string | null
    createdAt?: DateTimeFieldUpdateOperationsInput | Date | string
    updatedAt?: DateTimeFieldUpdateOperationsInput | Date | string
  }

  export type agent_contractsUncheckedUpdateInput = {
    id?: StringFieldUpdateOperationsInput | string
    agentId?: StringFieldUpdateOperationsInput | string
    stage?: StringFieldUpdateOperationsInput | string
    displayName?: StringFieldUpdateOperationsInput | string
    description?: NullableStringFieldUpdateOperationsInput | string | null
    schemaVersion?: StringFieldUpdateOperationsInput | string
    source?: StringFieldUpdateOperationsInput | string
    managedByCode?: BoolFieldUpdateOperationsInput | boolean
    metadata?: NullableStringFieldUpdateOperationsInput | string | null
    createdAt?: DateTimeFieldUpdateOperationsInput | Date | string
    updatedAt?: DateTimeFieldUpdateOperationsInput | Date | string
  }

  export type agent_contractsCreateManyInput = {
    id: string
    agentId: string
    stage: string
    displayName: string
    description?: string | null
    schemaVersion?: string
    source?: string
    managedByCode?: boolean
    metadata?: string | null
    createdAt?: Date | string
    updatedAt?: Date | string
  }

  export type agent_contractsUpdateManyMutationInput = {
    id?: StringFieldUpdateOperationsInput | string
    agentId?: StringFieldUpdateOperationsInput | string
    stage?: StringFieldUpdateOperationsInput | string
    displayName?: StringFieldUpdateOperationsInput | string
    description?: NullableStringFieldUpdateOperationsInput | string | null
    schemaVersion?: StringFieldUpdateOperationsInput | string
    source?: StringFieldUpdateOperationsInput | string
    managedByCode?: BoolFieldUpdateOperationsInput | boolean
    metadata?: NullableStringFieldUpdateOperationsInput | string | null
    createdAt?: DateTimeFieldUpdateOperationsInput | Date | string
    updatedAt?: DateTimeFieldUpdateOperationsInput | Date | string
  }

  export type agent_contractsUncheckedUpdateManyInput = {
    id?: StringFieldUpdateOperationsInput | string
    agentId?: StringFieldUpdateOperationsInput | string
    stage?: StringFieldUpdateOperationsInput | string
    displayName?: StringFieldUpdateOperationsInput | string
    description?: NullableStringFieldUpdateOperationsInput | string | null
    schemaVersion?: StringFieldUpdateOperationsInput | string
    source?: StringFieldUpdateOperationsInput | string
    managedByCode?: BoolFieldUpdateOperationsInput | boolean
    metadata?: NullableStringFieldUpdateOperationsInput | string | null
    createdAt?: DateTimeFieldUpdateOperationsInput | Date | string
    updatedAt?: DateTimeFieldUpdateOperationsInput | Date | string
  }

  export type agent_field_routingsCreateInput = {
    id: string
    agentId: string
    fieldId: string
    render?: string
    handoff?: string | null
    internalFlag?: boolean
    accumulate?: boolean
    visibilityPreset?: string | null
    ordering?: number
    notes?: string | null
    source?: string
    managedByCode?: boolean
    systemLocked?: boolean
    structureLocked?: boolean
    createdAt?: Date | string
    updatedAt?: Date | string
  }

  export type agent_field_routingsUncheckedCreateInput = {
    id: string
    agentId: string
    fieldId: string
    render?: string
    handoff?: string | null
    internalFlag?: boolean
    accumulate?: boolean
    visibilityPreset?: string | null
    ordering?: number
    notes?: string | null
    source?: string
    managedByCode?: boolean
    systemLocked?: boolean
    structureLocked?: boolean
    createdAt?: Date | string
    updatedAt?: Date | string
  }

  export type agent_field_routingsUpdateInput = {
    id?: StringFieldUpdateOperationsInput | string
    agentId?: StringFieldUpdateOperationsInput | string
    fieldId?: StringFieldUpdateOperationsInput | string
    render?: StringFieldUpdateOperationsInput | string
    handoff?: NullableStringFieldUpdateOperationsInput | string | null
    internalFlag?: BoolFieldUpdateOperationsInput | boolean
    accumulate?: BoolFieldUpdateOperationsInput | boolean
    visibilityPreset?: NullableStringFieldUpdateOperationsInput | string | null
    ordering?: IntFieldUpdateOperationsInput | number
    notes?: NullableStringFieldUpdateOperationsInput | string | null
    source?: StringFieldUpdateOperationsInput | string
    managedByCode?: BoolFieldUpdateOperationsInput | boolean
    systemLocked?: BoolFieldUpdateOperationsInput | boolean
    structureLocked?: BoolFieldUpdateOperationsInput | boolean
    createdAt?: DateTimeFieldUpdateOperationsInput | Date | string
    updatedAt?: DateTimeFieldUpdateOperationsInput | Date | string
  }

  export type agent_field_routingsUncheckedUpdateInput = {
    id?: StringFieldUpdateOperationsInput | string
    agentId?: StringFieldUpdateOperationsInput | string
    fieldId?: StringFieldUpdateOperationsInput | string
    render?: StringFieldUpdateOperationsInput | string
    handoff?: NullableStringFieldUpdateOperationsInput | string | null
    internalFlag?: BoolFieldUpdateOperationsInput | boolean
    accumulate?: BoolFieldUpdateOperationsInput | boolean
    visibilityPreset?: NullableStringFieldUpdateOperationsInput | string | null
    ordering?: IntFieldUpdateOperationsInput | number
    notes?: NullableStringFieldUpdateOperationsInput | string | null
    source?: StringFieldUpdateOperationsInput | string
    managedByCode?: BoolFieldUpdateOperationsInput | boolean
    systemLocked?: BoolFieldUpdateOperationsInput | boolean
    structureLocked?: BoolFieldUpdateOperationsInput | boolean
    createdAt?: DateTimeFieldUpdateOperationsInput | Date | string
    updatedAt?: DateTimeFieldUpdateOperationsInput | Date | string
  }

  export type agent_field_routingsCreateManyInput = {
    id: string
    agentId: string
    fieldId: string
    render?: string
    handoff?: string | null
    internalFlag?: boolean
    accumulate?: boolean
    visibilityPreset?: string | null
    ordering?: number
    notes?: string | null
    source?: string
    managedByCode?: boolean
    systemLocked?: boolean
    structureLocked?: boolean
    createdAt?: Date | string
    updatedAt?: Date | string
  }

  export type agent_field_routingsUpdateManyMutationInput = {
    id?: StringFieldUpdateOperationsInput | string
    agentId?: StringFieldUpdateOperationsInput | string
    fieldId?: StringFieldUpdateOperationsInput | string
    render?: StringFieldUpdateOperationsInput | string
    handoff?: NullableStringFieldUpdateOperationsInput | string | null
    internalFlag?: BoolFieldUpdateOperationsInput | boolean
    accumulate?: BoolFieldUpdateOperationsInput | boolean
    visibilityPreset?: NullableStringFieldUpdateOperationsInput | string | null
    ordering?: IntFieldUpdateOperationsInput | number
    notes?: NullableStringFieldUpdateOperationsInput | string | null
    source?: StringFieldUpdateOperationsInput | string
    managedByCode?: BoolFieldUpdateOperationsInput | boolean
    systemLocked?: BoolFieldUpdateOperationsInput | boolean
    structureLocked?: BoolFieldUpdateOperationsInput | boolean
    createdAt?: DateTimeFieldUpdateOperationsInput | Date | string
    updatedAt?: DateTimeFieldUpdateOperationsInput | Date | string
  }

  export type agent_field_routingsUncheckedUpdateManyInput = {
    id?: StringFieldUpdateOperationsInput | string
    agentId?: StringFieldUpdateOperationsInput | string
    fieldId?: StringFieldUpdateOperationsInput | string
    render?: StringFieldUpdateOperationsInput | string
    handoff?: NullableStringFieldUpdateOperationsInput | string | null
    internalFlag?: BoolFieldUpdateOperationsInput | boolean
    accumulate?: BoolFieldUpdateOperationsInput | boolean
    visibilityPreset?: NullableStringFieldUpdateOperationsInput | string | null
    ordering?: IntFieldUpdateOperationsInput | number
    notes?: NullableStringFieldUpdateOperationsInput | string | null
    source?: StringFieldUpdateOperationsInput | string
    managedByCode?: BoolFieldUpdateOperationsInput | boolean
    systemLocked?: BoolFieldUpdateOperationsInput | boolean
    structureLocked?: BoolFieldUpdateOperationsInput | boolean
    createdAt?: DateTimeFieldUpdateOperationsInput | Date | string
    updatedAt?: DateTimeFieldUpdateOperationsInput | Date | string
  }

  export type node_config_changesCreateInput = {
    id: string
    changeType: string
    targetTable: string
    targetId: string
    agentId?: string | null
    fieldId?: string | null
    before?: string | null
    after?: string | null
    actorId?: string | null
    actorRole?: string | null
    reason?: string | null
    createdAt?: Date | string
  }

  export type node_config_changesUncheckedCreateInput = {
    id: string
    changeType: string
    targetTable: string
    targetId: string
    agentId?: string | null
    fieldId?: string | null
    before?: string | null
    after?: string | null
    actorId?: string | null
    actorRole?: string | null
    reason?: string | null
    createdAt?: Date | string
  }

  export type node_config_changesUpdateInput = {
    id?: StringFieldUpdateOperationsInput | string
    changeType?: StringFieldUpdateOperationsInput | string
    targetTable?: StringFieldUpdateOperationsInput | string
    targetId?: StringFieldUpdateOperationsInput | string
    agentId?: NullableStringFieldUpdateOperationsInput | string | null
    fieldId?: NullableStringFieldUpdateOperationsInput | string | null
    before?: NullableStringFieldUpdateOperationsInput | string | null
    after?: NullableStringFieldUpdateOperationsInput | string | null
    actorId?: NullableStringFieldUpdateOperationsInput | string | null
    actorRole?: NullableStringFieldUpdateOperationsInput | string | null
    reason?: NullableStringFieldUpdateOperationsInput | string | null
    createdAt?: DateTimeFieldUpdateOperationsInput | Date | string
  }

  export type node_config_changesUncheckedUpdateInput = {
    id?: StringFieldUpdateOperationsInput | string
    changeType?: StringFieldUpdateOperationsInput | string
    targetTable?: StringFieldUpdateOperationsInput | string
    targetId?: StringFieldUpdateOperationsInput | string
    agentId?: NullableStringFieldUpdateOperationsInput | string | null
    fieldId?: NullableStringFieldUpdateOperationsInput | string | null
    before?: NullableStringFieldUpdateOperationsInput | string | null
    after?: NullableStringFieldUpdateOperationsInput | string | null
    actorId?: NullableStringFieldUpdateOperationsInput | string | null
    actorRole?: NullableStringFieldUpdateOperationsInput | string | null
    reason?: NullableStringFieldUpdateOperationsInput | string | null
    createdAt?: DateTimeFieldUpdateOperationsInput | Date | string
  }

  export type node_config_changesCreateManyInput = {
    id: string
    changeType: string
    targetTable: string
    targetId: string
    agentId?: string | null
    fieldId?: string | null
    before?: string | null
    after?: string | null
    actorId?: string | null
    actorRole?: string | null
    reason?: string | null
    createdAt?: Date | string
  }

  export type node_config_changesUpdateManyMutationInput = {
    id?: StringFieldUpdateOperationsInput | string
    changeType?: StringFieldUpdateOperationsInput | string
    targetTable?: StringFieldUpdateOperationsInput | string
    targetId?: StringFieldUpdateOperationsInput | string
    agentId?: NullableStringFieldUpdateOperationsInput | string | null
    fieldId?: NullableStringFieldUpdateOperationsInput | string | null
    before?: NullableStringFieldUpdateOperationsInput | string | null
    after?: NullableStringFieldUpdateOperationsInput | string | null
    actorId?: NullableStringFieldUpdateOperationsInput | string | null
    actorRole?: NullableStringFieldUpdateOperationsInput | string | null
    reason?: NullableStringFieldUpdateOperationsInput | string | null
    createdAt?: DateTimeFieldUpdateOperationsInput | Date | string
  }

  export type node_config_changesUncheckedUpdateManyInput = {
    id?: StringFieldUpdateOperationsInput | string
    changeType?: StringFieldUpdateOperationsInput | string
    targetTable?: StringFieldUpdateOperationsInput | string
    targetId?: StringFieldUpdateOperationsInput | string
    agentId?: NullableStringFieldUpdateOperationsInput | string | null
    fieldId?: NullableStringFieldUpdateOperationsInput | string | null
    before?: NullableStringFieldUpdateOperationsInput | string | null
    after?: NullableStringFieldUpdateOperationsInput | string | null
    actorId?: NullableStringFieldUpdateOperationsInput | string | null
    actorRole?: NullableStringFieldUpdateOperationsInput | string | null
    reason?: NullableStringFieldUpdateOperationsInput | string | null
    createdAt?: DateTimeFieldUpdateOperationsInput | Date | string
  }

  export type prompt_eval_casesCreateInput = {
    id: string
    agentId: string
    caseId: string
    name: string
    description?: string | null
    messagesJson: string
    previousStateJson?: string | null
    expectationsJson?: string | null
    enabled?: boolean
    createdBy?: string | null
    createdAt?: Date | string
    updatedAt?: Date | string
  }

  export type prompt_eval_casesUncheckedCreateInput = {
    id: string
    agentId: string
    caseId: string
    name: string
    description?: string | null
    messagesJson: string
    previousStateJson?: string | null
    expectationsJson?: string | null
    enabled?: boolean
    createdBy?: string | null
    createdAt?: Date | string
    updatedAt?: Date | string
  }

  export type prompt_eval_casesUpdateInput = {
    id?: StringFieldUpdateOperationsInput | string
    agentId?: StringFieldUpdateOperationsInput | string
    caseId?: StringFieldUpdateOperationsInput | string
    name?: StringFieldUpdateOperationsInput | string
    description?: NullableStringFieldUpdateOperationsInput | string | null
    messagesJson?: StringFieldUpdateOperationsInput | string
    previousStateJson?: NullableStringFieldUpdateOperationsInput | string | null
    expectationsJson?: NullableStringFieldUpdateOperationsInput | string | null
    enabled?: BoolFieldUpdateOperationsInput | boolean
    createdBy?: NullableStringFieldUpdateOperationsInput | string | null
    createdAt?: DateTimeFieldUpdateOperationsInput | Date | string
    updatedAt?: DateTimeFieldUpdateOperationsInput | Date | string
  }

  export type prompt_eval_casesUncheckedUpdateInput = {
    id?: StringFieldUpdateOperationsInput | string
    agentId?: StringFieldUpdateOperationsInput | string
    caseId?: StringFieldUpdateOperationsInput | string
    name?: StringFieldUpdateOperationsInput | string
    description?: NullableStringFieldUpdateOperationsInput | string | null
    messagesJson?: StringFieldUpdateOperationsInput | string
    previousStateJson?: NullableStringFieldUpdateOperationsInput | string | null
    expectationsJson?: NullableStringFieldUpdateOperationsInput | string | null
    enabled?: BoolFieldUpdateOperationsInput | boolean
    createdBy?: NullableStringFieldUpdateOperationsInput | string | null
    createdAt?: DateTimeFieldUpdateOperationsInput | Date | string
    updatedAt?: DateTimeFieldUpdateOperationsInput | Date | string
  }

  export type prompt_eval_casesCreateManyInput = {
    id: string
    agentId: string
    caseId: string
    name: string
    description?: string | null
    messagesJson: string
    previousStateJson?: string | null
    expectationsJson?: string | null
    enabled?: boolean
    createdBy?: string | null
    createdAt?: Date | string
    updatedAt?: Date | string
  }

  export type prompt_eval_casesUpdateManyMutationInput = {
    id?: StringFieldUpdateOperationsInput | string
    agentId?: StringFieldUpdateOperationsInput | string
    caseId?: StringFieldUpdateOperationsInput | string
    name?: StringFieldUpdateOperationsInput | string
    description?: NullableStringFieldUpdateOperationsInput | string | null
    messagesJson?: StringFieldUpdateOperationsInput | string
    previousStateJson?: NullableStringFieldUpdateOperationsInput | string | null
    expectationsJson?: NullableStringFieldUpdateOperationsInput | string | null
    enabled?: BoolFieldUpdateOperationsInput | boolean
    createdBy?: NullableStringFieldUpdateOperationsInput | string | null
    createdAt?: DateTimeFieldUpdateOperationsInput | Date | string
    updatedAt?: DateTimeFieldUpdateOperationsInput | Date | string
  }

  export type prompt_eval_casesUncheckedUpdateManyInput = {
    id?: StringFieldUpdateOperationsInput | string
    agentId?: StringFieldUpdateOperationsInput | string
    caseId?: StringFieldUpdateOperationsInput | string
    name?: StringFieldUpdateOperationsInput | string
    description?: NullableStringFieldUpdateOperationsInput | string | null
    messagesJson?: StringFieldUpdateOperationsInput | string
    previousStateJson?: NullableStringFieldUpdateOperationsInput | string | null
    expectationsJson?: NullableStringFieldUpdateOperationsInput | string | null
    enabled?: BoolFieldUpdateOperationsInput | boolean
    createdBy?: NullableStringFieldUpdateOperationsInput | string | null
    createdAt?: DateTimeFieldUpdateOperationsInput | Date | string
    updatedAt?: DateTimeFieldUpdateOperationsInput | Date | string
  }

  export type prompt_eval_runsCreateInput = {
    id: string
    agentId: string
    promptVersionId?: string | null
    promptVersion?: number | null
    promptSource: string
    mode: string
    caseCount?: number
    totalRuns?: number
    summaryJson: string
    resultsJson?: string | null
    durationMs?: number
    triggeredBy?: string | null
    createdAt?: Date | string
  }

  export type prompt_eval_runsUncheckedCreateInput = {
    id: string
    agentId: string
    promptVersionId?: string | null
    promptVersion?: number | null
    promptSource: string
    mode: string
    caseCount?: number
    totalRuns?: number
    summaryJson: string
    resultsJson?: string | null
    durationMs?: number
    triggeredBy?: string | null
    createdAt?: Date | string
  }

  export type prompt_eval_runsUpdateInput = {
    id?: StringFieldUpdateOperationsInput | string
    agentId?: StringFieldUpdateOperationsInput | string
    promptVersionId?: NullableStringFieldUpdateOperationsInput | string | null
    promptVersion?: NullableIntFieldUpdateOperationsInput | number | null
    promptSource?: StringFieldUpdateOperationsInput | string
    mode?: StringFieldUpdateOperationsInput | string
    caseCount?: IntFieldUpdateOperationsInput | number
    totalRuns?: IntFieldUpdateOperationsInput | number
    summaryJson?: StringFieldUpdateOperationsInput | string
    resultsJson?: NullableStringFieldUpdateOperationsInput | string | null
    durationMs?: IntFieldUpdateOperationsInput | number
    triggeredBy?: NullableStringFieldUpdateOperationsInput | string | null
    createdAt?: DateTimeFieldUpdateOperationsInput | Date | string
  }

  export type prompt_eval_runsUncheckedUpdateInput = {
    id?: StringFieldUpdateOperationsInput | string
    agentId?: StringFieldUpdateOperationsInput | string
    promptVersionId?: NullableStringFieldUpdateOperationsInput | string | null
    promptVersion?: NullableIntFieldUpdateOperationsInput | number | null
    promptSource?: StringFieldUpdateOperationsInput | string
    mode?: StringFieldUpdateOperationsInput | string
    caseCount?: IntFieldUpdateOperationsInput | number
    totalRuns?: IntFieldUpdateOperationsInput | number
    summaryJson?: StringFieldUpdateOperationsInput | string
    resultsJson?: NullableStringFieldUpdateOperationsInput | string | null
    durationMs?: IntFieldUpdateOperationsInput | number
    triggeredBy?: NullableStringFieldUpdateOperationsInput | string | null
    createdAt?: DateTimeFieldUpdateOperationsInput | Date | string
  }

  export type prompt_eval_runsCreateManyInput = {
    id: string
    agentId: string
    promptVersionId?: string | null
    promptVersion?: number | null
    promptSource: string
    mode: string
    caseCount?: number
    totalRuns?: number
    summaryJson: string
    resultsJson?: string | null
    durationMs?: number
    triggeredBy?: string | null
    createdAt?: Date | string
  }

  export type prompt_eval_runsUpdateManyMutationInput = {
    id?: StringFieldUpdateOperationsInput | string
    agentId?: StringFieldUpdateOperationsInput | string
    promptVersionId?: NullableStringFieldUpdateOperationsInput | string | null
    promptVersion?: NullableIntFieldUpdateOperationsInput | number | null
    promptSource?: StringFieldUpdateOperationsInput | string
    mode?: StringFieldUpdateOperationsInput | string
    caseCount?: IntFieldUpdateOperationsInput | number
    totalRuns?: IntFieldUpdateOperationsInput | number
    summaryJson?: StringFieldUpdateOperationsInput | string
    resultsJson?: NullableStringFieldUpdateOperationsInput | string | null
    durationMs?: IntFieldUpdateOperationsInput | number
    triggeredBy?: NullableStringFieldUpdateOperationsInput | string | null
    createdAt?: DateTimeFieldUpdateOperationsInput | Date | string
  }

  export type prompt_eval_runsUncheckedUpdateManyInput = {
    id?: StringFieldUpdateOperationsInput | string
    agentId?: StringFieldUpdateOperationsInput | string
    promptVersionId?: NullableStringFieldUpdateOperationsInput | string | null
    promptVersion?: NullableIntFieldUpdateOperationsInput | number | null
    promptSource?: StringFieldUpdateOperationsInput | string
    mode?: StringFieldUpdateOperationsInput | string
    caseCount?: IntFieldUpdateOperationsInput | number
    totalRuns?: IntFieldUpdateOperationsInput | number
    summaryJson?: StringFieldUpdateOperationsInput | string
    resultsJson?: NullableStringFieldUpdateOperationsInput | string | null
    durationMs?: IntFieldUpdateOperationsInput | number
    triggeredBy?: NullableStringFieldUpdateOperationsInput | string | null
    createdAt?: DateTimeFieldUpdateOperationsInput | Date | string
  }

  export type StringFilter<$PrismaModel = never> = {
    equals?: string | StringFieldRefInput<$PrismaModel>
    in?: string[]
    notIn?: string[]
    lt?: string | StringFieldRefInput<$PrismaModel>
    lte?: string | StringFieldRefInput<$PrismaModel>
    gt?: string | StringFieldRefInput<$PrismaModel>
    gte?: string | StringFieldRefInput<$PrismaModel>
    contains?: string | StringFieldRefInput<$PrismaModel>
    startsWith?: string | StringFieldRefInput<$PrismaModel>
    endsWith?: string | StringFieldRefInput<$PrismaModel>
    not?: NestedStringFilter<$PrismaModel> | string
  }

  export type StringNullableFilter<$PrismaModel = never> = {
    equals?: string | StringFieldRefInput<$PrismaModel> | null
    in?: string[] | null
    notIn?: string[] | null
    lt?: string | StringFieldRefInput<$PrismaModel>
    lte?: string | StringFieldRefInput<$PrismaModel>
    gt?: string | StringFieldRefInput<$PrismaModel>
    gte?: string | StringFieldRefInput<$PrismaModel>
    contains?: string | StringFieldRefInput<$PrismaModel>
    startsWith?: string | StringFieldRefInput<$PrismaModel>
    endsWith?: string | StringFieldRefInput<$PrismaModel>
    not?: NestedStringNullableFilter<$PrismaModel> | string | null
  }

  export type FloatNullableFilter<$PrismaModel = never> = {
    equals?: number | FloatFieldRefInput<$PrismaModel> | null
    in?: number[] | null
    notIn?: number[] | null
    lt?: number | FloatFieldRefInput<$PrismaModel>
    lte?: number | FloatFieldRefInput<$PrismaModel>
    gt?: number | FloatFieldRefInput<$PrismaModel>
    gte?: number | FloatFieldRefInput<$PrismaModel>
    not?: NestedFloatNullableFilter<$PrismaModel> | number | null
  }

  export type IntNullableFilter<$PrismaModel = never> = {
    equals?: number | IntFieldRefInput<$PrismaModel> | null
    in?: number[] | null
    notIn?: number[] | null
    lt?: number | IntFieldRefInput<$PrismaModel>
    lte?: number | IntFieldRefInput<$PrismaModel>
    gt?: number | IntFieldRefInput<$PrismaModel>
    gte?: number | IntFieldRefInput<$PrismaModel>
    not?: NestedIntNullableFilter<$PrismaModel> | number | null
  }

  export type DateTimeFilter<$PrismaModel = never> = {
    equals?: Date | string | DateTimeFieldRefInput<$PrismaModel>
    in?: Date[] | string[]
    notIn?: Date[] | string[]
    lt?: Date | string | DateTimeFieldRefInput<$PrismaModel>
    lte?: Date | string | DateTimeFieldRefInput<$PrismaModel>
    gt?: Date | string | DateTimeFieldRefInput<$PrismaModel>
    gte?: Date | string | DateTimeFieldRefInput<$PrismaModel>
    not?: NestedDateTimeFilter<$PrismaModel> | Date | string
  }

  export type SortOrderInput = {
    sort: SortOrder
    nulls?: NullsOrder
  }

  export type agent_lab_configsCountOrderByAggregateInput = {
    id?: SortOrder
    agentName?: SortOrder
    model?: SortOrder
    temperature?: SortOrder
    maxTokens?: SortOrder
    baseURL?: SortOrder
    apiKey?: SortOrder
    systemPrompt?: SortOrder
    extraConfig?: SortOrder
    createdAt?: SortOrder
    updatedAt?: SortOrder
  }

  export type agent_lab_configsAvgOrderByAggregateInput = {
    temperature?: SortOrder
    maxTokens?: SortOrder
  }

  export type agent_lab_configsMaxOrderByAggregateInput = {
    id?: SortOrder
    agentName?: SortOrder
    model?: SortOrder
    temperature?: SortOrder
    maxTokens?: SortOrder
    baseURL?: SortOrder
    apiKey?: SortOrder
    systemPrompt?: SortOrder
    extraConfig?: SortOrder
    createdAt?: SortOrder
    updatedAt?: SortOrder
  }

  export type agent_lab_configsMinOrderByAggregateInput = {
    id?: SortOrder
    agentName?: SortOrder
    model?: SortOrder
    temperature?: SortOrder
    maxTokens?: SortOrder
    baseURL?: SortOrder
    apiKey?: SortOrder
    systemPrompt?: SortOrder
    extraConfig?: SortOrder
    createdAt?: SortOrder
    updatedAt?: SortOrder
  }

  export type agent_lab_configsSumOrderByAggregateInput = {
    temperature?: SortOrder
    maxTokens?: SortOrder
  }

  export type StringWithAggregatesFilter<$PrismaModel = never> = {
    equals?: string | StringFieldRefInput<$PrismaModel>
    in?: string[]
    notIn?: string[]
    lt?: string | StringFieldRefInput<$PrismaModel>
    lte?: string | StringFieldRefInput<$PrismaModel>
    gt?: string | StringFieldRefInput<$PrismaModel>
    gte?: string | StringFieldRefInput<$PrismaModel>
    contains?: string | StringFieldRefInput<$PrismaModel>
    startsWith?: string | StringFieldRefInput<$PrismaModel>
    endsWith?: string | StringFieldRefInput<$PrismaModel>
    not?: NestedStringWithAggregatesFilter<$PrismaModel> | string
    _count?: NestedIntFilter<$PrismaModel>
    _min?: NestedStringFilter<$PrismaModel>
    _max?: NestedStringFilter<$PrismaModel>
  }

  export type StringNullableWithAggregatesFilter<$PrismaModel = never> = {
    equals?: string | StringFieldRefInput<$PrismaModel> | null
    in?: string[] | null
    notIn?: string[] | null
    lt?: string | StringFieldRefInput<$PrismaModel>
    lte?: string | StringFieldRefInput<$PrismaModel>
    gt?: string | StringFieldRefInput<$PrismaModel>
    gte?: string | StringFieldRefInput<$PrismaModel>
    contains?: string | StringFieldRefInput<$PrismaModel>
    startsWith?: string | StringFieldRefInput<$PrismaModel>
    endsWith?: string | StringFieldRefInput<$PrismaModel>
    not?: NestedStringNullableWithAggregatesFilter<$PrismaModel> | string | null
    _count?: NestedIntNullableFilter<$PrismaModel>
    _min?: NestedStringNullableFilter<$PrismaModel>
    _max?: NestedStringNullableFilter<$PrismaModel>
  }

  export type FloatNullableWithAggregatesFilter<$PrismaModel = never> = {
    equals?: number | FloatFieldRefInput<$PrismaModel> | null
    in?: number[] | null
    notIn?: number[] | null
    lt?: number | FloatFieldRefInput<$PrismaModel>
    lte?: number | FloatFieldRefInput<$PrismaModel>
    gt?: number | FloatFieldRefInput<$PrismaModel>
    gte?: number | FloatFieldRefInput<$PrismaModel>
    not?: NestedFloatNullableWithAggregatesFilter<$PrismaModel> | number | null
    _count?: NestedIntNullableFilter<$PrismaModel>
    _avg?: NestedFloatNullableFilter<$PrismaModel>
    _sum?: NestedFloatNullableFilter<$PrismaModel>
    _min?: NestedFloatNullableFilter<$PrismaModel>
    _max?: NestedFloatNullableFilter<$PrismaModel>
  }

  export type IntNullableWithAggregatesFilter<$PrismaModel = never> = {
    equals?: number | IntFieldRefInput<$PrismaModel> | null
    in?: number[] | null
    notIn?: number[] | null
    lt?: number | IntFieldRefInput<$PrismaModel>
    lte?: number | IntFieldRefInput<$PrismaModel>
    gt?: number | IntFieldRefInput<$PrismaModel>
    gte?: number | IntFieldRefInput<$PrismaModel>
    not?: NestedIntNullableWithAggregatesFilter<$PrismaModel> | number | null
    _count?: NestedIntNullableFilter<$PrismaModel>
    _avg?: NestedFloatNullableFilter<$PrismaModel>
    _sum?: NestedIntNullableFilter<$PrismaModel>
    _min?: NestedIntNullableFilter<$PrismaModel>
    _max?: NestedIntNullableFilter<$PrismaModel>
  }

  export type DateTimeWithAggregatesFilter<$PrismaModel = never> = {
    equals?: Date | string | DateTimeFieldRefInput<$PrismaModel>
    in?: Date[] | string[]
    notIn?: Date[] | string[]
    lt?: Date | string | DateTimeFieldRefInput<$PrismaModel>
    lte?: Date | string | DateTimeFieldRefInput<$PrismaModel>
    gt?: Date | string | DateTimeFieldRefInput<$PrismaModel>
    gte?: Date | string | DateTimeFieldRefInput<$PrismaModel>
    not?: NestedDateTimeWithAggregatesFilter<$PrismaModel> | Date | string
    _count?: NestedIntFilter<$PrismaModel>
    _min?: NestedDateTimeFilter<$PrismaModel>
    _max?: NestedDateTimeFilter<$PrismaModel>
  }

  export type FloatFilter<$PrismaModel = never> = {
    equals?: number | FloatFieldRefInput<$PrismaModel>
    in?: number[]
    notIn?: number[]
    lt?: number | FloatFieldRefInput<$PrismaModel>
    lte?: number | FloatFieldRefInput<$PrismaModel>
    gt?: number | FloatFieldRefInput<$PrismaModel>
    gte?: number | FloatFieldRefInput<$PrismaModel>
    not?: NestedFloatFilter<$PrismaModel> | number
  }

  export type IntFilter<$PrismaModel = never> = {
    equals?: number | IntFieldRefInput<$PrismaModel>
    in?: number[]
    notIn?: number[]
    lt?: number | IntFieldRefInput<$PrismaModel>
    lte?: number | IntFieldRefInput<$PrismaModel>
    gt?: number | IntFieldRefInput<$PrismaModel>
    gte?: number | IntFieldRefInput<$PrismaModel>
    not?: NestedIntFilter<$PrismaModel> | number
  }

  export type BoolFilter<$PrismaModel = never> = {
    equals?: boolean | BooleanFieldRefInput<$PrismaModel>
    not?: NestedBoolFilter<$PrismaModel> | boolean
  }

  export type agent_model_configsCountOrderByAggregateInput = {
    id?: SortOrder
    agentId?: SortOrder
    tier?: SortOrder
    model?: SortOrder
    endpoint?: SortOrder
    apiKey?: SortOrder
    temperature?: SortOrder
    maxTokens?: SortOrder
    priority?: SortOrder
    enabled?: SortOrder
    createdAt?: SortOrder
    updatedAt?: SortOrder
    reasoningEffort?: SortOrder
    thinkingMode?: SortOrder
  }

  export type agent_model_configsAvgOrderByAggregateInput = {
    temperature?: SortOrder
    maxTokens?: SortOrder
    priority?: SortOrder
  }

  export type agent_model_configsMaxOrderByAggregateInput = {
    id?: SortOrder
    agentId?: SortOrder
    tier?: SortOrder
    model?: SortOrder
    endpoint?: SortOrder
    apiKey?: SortOrder
    temperature?: SortOrder
    maxTokens?: SortOrder
    priority?: SortOrder
    enabled?: SortOrder
    createdAt?: SortOrder
    updatedAt?: SortOrder
    reasoningEffort?: SortOrder
    thinkingMode?: SortOrder
  }

  export type agent_model_configsMinOrderByAggregateInput = {
    id?: SortOrder
    agentId?: SortOrder
    tier?: SortOrder
    model?: SortOrder
    endpoint?: SortOrder
    apiKey?: SortOrder
    temperature?: SortOrder
    maxTokens?: SortOrder
    priority?: SortOrder
    enabled?: SortOrder
    createdAt?: SortOrder
    updatedAt?: SortOrder
    reasoningEffort?: SortOrder
    thinkingMode?: SortOrder
  }

  export type agent_model_configsSumOrderByAggregateInput = {
    temperature?: SortOrder
    maxTokens?: SortOrder
    priority?: SortOrder
  }

  export type FloatWithAggregatesFilter<$PrismaModel = never> = {
    equals?: number | FloatFieldRefInput<$PrismaModel>
    in?: number[]
    notIn?: number[]
    lt?: number | FloatFieldRefInput<$PrismaModel>
    lte?: number | FloatFieldRefInput<$PrismaModel>
    gt?: number | FloatFieldRefInput<$PrismaModel>
    gte?: number | FloatFieldRefInput<$PrismaModel>
    not?: NestedFloatWithAggregatesFilter<$PrismaModel> | number
    _count?: NestedIntFilter<$PrismaModel>
    _avg?: NestedFloatFilter<$PrismaModel>
    _sum?: NestedFloatFilter<$PrismaModel>
    _min?: NestedFloatFilter<$PrismaModel>
    _max?: NestedFloatFilter<$PrismaModel>
  }

  export type IntWithAggregatesFilter<$PrismaModel = never> = {
    equals?: number | IntFieldRefInput<$PrismaModel>
    in?: number[]
    notIn?: number[]
    lt?: number | IntFieldRefInput<$PrismaModel>
    lte?: number | IntFieldRefInput<$PrismaModel>
    gt?: number | IntFieldRefInput<$PrismaModel>
    gte?: number | IntFieldRefInput<$PrismaModel>
    not?: NestedIntWithAggregatesFilter<$PrismaModel> | number
    _count?: NestedIntFilter<$PrismaModel>
    _avg?: NestedFloatFilter<$PrismaModel>
    _sum?: NestedIntFilter<$PrismaModel>
    _min?: NestedIntFilter<$PrismaModel>
    _max?: NestedIntFilter<$PrismaModel>
  }

  export type BoolWithAggregatesFilter<$PrismaModel = never> = {
    equals?: boolean | BooleanFieldRefInput<$PrismaModel>
    not?: NestedBoolWithAggregatesFilter<$PrismaModel> | boolean
    _count?: NestedIntFilter<$PrismaModel>
    _min?: NestedBoolFilter<$PrismaModel>
    _max?: NestedBoolFilter<$PrismaModel>
  }

  export type DateTimeNullableFilter<$PrismaModel = never> = {
    equals?: Date | string | DateTimeFieldRefInput<$PrismaModel> | null
    in?: Date[] | string[] | null
    notIn?: Date[] | string[] | null
    lt?: Date | string | DateTimeFieldRefInput<$PrismaModel>
    lte?: Date | string | DateTimeFieldRefInput<$PrismaModel>
    gt?: Date | string | DateTimeFieldRefInput<$PrismaModel>
    gte?: Date | string | DateTimeFieldRefInput<$PrismaModel>
    not?: NestedDateTimeNullableFilter<$PrismaModel> | Date | string | null
  }

  export type agent_promptsAgentIdVersionCompoundUniqueInput = {
    agentId: string
    version: number
  }

  export type agent_promptsCountOrderByAggregateInput = {
    id?: SortOrder
    agentId?: SortOrder
    version?: SortOrder
    name?: SortOrder
    description?: SortOrder
    systemPrompt?: SortOrder
    compiledSystemPrompt?: SortOrder
    compileStatus?: SortOrder
    compileError?: SortOrder
    sourceHash?: SortOrder
    compileContextHash?: SortOrder
    compiledAt?: SortOrder
    temperature?: SortOrder
    maxTokens?: SortOrder
    model?: SortOrder
    status?: SortOrder
    createdBy?: SortOrder
    createdAt?: SortOrder
    updatedAt?: SortOrder
    metadata?: SortOrder
    useCount?: SortOrder
    avgLatency?: SortOrder
    successRate?: SortOrder
    publishedAt?: SortOrder
  }

  export type agent_promptsAvgOrderByAggregateInput = {
    version?: SortOrder
    temperature?: SortOrder
    maxTokens?: SortOrder
    useCount?: SortOrder
    avgLatency?: SortOrder
    successRate?: SortOrder
  }

  export type agent_promptsMaxOrderByAggregateInput = {
    id?: SortOrder
    agentId?: SortOrder
    version?: SortOrder
    name?: SortOrder
    description?: SortOrder
    systemPrompt?: SortOrder
    compiledSystemPrompt?: SortOrder
    compileStatus?: SortOrder
    compileError?: SortOrder
    sourceHash?: SortOrder
    compileContextHash?: SortOrder
    compiledAt?: SortOrder
    temperature?: SortOrder
    maxTokens?: SortOrder
    model?: SortOrder
    status?: SortOrder
    createdBy?: SortOrder
    createdAt?: SortOrder
    updatedAt?: SortOrder
    metadata?: SortOrder
    useCount?: SortOrder
    avgLatency?: SortOrder
    successRate?: SortOrder
    publishedAt?: SortOrder
  }

  export type agent_promptsMinOrderByAggregateInput = {
    id?: SortOrder
    agentId?: SortOrder
    version?: SortOrder
    name?: SortOrder
    description?: SortOrder
    systemPrompt?: SortOrder
    compiledSystemPrompt?: SortOrder
    compileStatus?: SortOrder
    compileError?: SortOrder
    sourceHash?: SortOrder
    compileContextHash?: SortOrder
    compiledAt?: SortOrder
    temperature?: SortOrder
    maxTokens?: SortOrder
    model?: SortOrder
    status?: SortOrder
    createdBy?: SortOrder
    createdAt?: SortOrder
    updatedAt?: SortOrder
    metadata?: SortOrder
    useCount?: SortOrder
    avgLatency?: SortOrder
    successRate?: SortOrder
    publishedAt?: SortOrder
  }

  export type agent_promptsSumOrderByAggregateInput = {
    version?: SortOrder
    temperature?: SortOrder
    maxTokens?: SortOrder
    useCount?: SortOrder
    avgLatency?: SortOrder
    successRate?: SortOrder
  }

  export type DateTimeNullableWithAggregatesFilter<$PrismaModel = never> = {
    equals?: Date | string | DateTimeFieldRefInput<$PrismaModel> | null
    in?: Date[] | string[] | null
    notIn?: Date[] | string[] | null
    lt?: Date | string | DateTimeFieldRefInput<$PrismaModel>
    lte?: Date | string | DateTimeFieldRefInput<$PrismaModel>
    gt?: Date | string | DateTimeFieldRefInput<$PrismaModel>
    gte?: Date | string | DateTimeFieldRefInput<$PrismaModel>
    not?: NestedDateTimeNullableWithAggregatesFilter<$PrismaModel> | Date | string | null
    _count?: NestedIntNullableFilter<$PrismaModel>
    _min?: NestedDateTimeNullableFilter<$PrismaModel>
    _max?: NestedDateTimeNullableFilter<$PrismaModel>
  }

  export type agent_definitionsCountOrderByAggregateInput = {
    id?: SortOrder
    displayName?: SortOrder
    description?: SortOrder
    category?: SortOrder
    inputSchema?: SortOrder
    outputSchema?: SortOrder
    variableBindings?: SortOrder
    capabilities?: SortOrder
    defaultMaxTokens?: SortOrder
    defaultTemperature?: SortOrder
    schemaVersion?: SortOrder
    source?: SortOrder
    managedByCode?: SortOrder
    createdAt?: SortOrder
    updatedAt?: SortOrder
  }

  export type agent_definitionsAvgOrderByAggregateInput = {
    defaultMaxTokens?: SortOrder
    defaultTemperature?: SortOrder
    schemaVersion?: SortOrder
  }

  export type agent_definitionsMaxOrderByAggregateInput = {
    id?: SortOrder
    displayName?: SortOrder
    description?: SortOrder
    category?: SortOrder
    inputSchema?: SortOrder
    outputSchema?: SortOrder
    variableBindings?: SortOrder
    capabilities?: SortOrder
    defaultMaxTokens?: SortOrder
    defaultTemperature?: SortOrder
    schemaVersion?: SortOrder
    source?: SortOrder
    managedByCode?: SortOrder
    createdAt?: SortOrder
    updatedAt?: SortOrder
  }

  export type agent_definitionsMinOrderByAggregateInput = {
    id?: SortOrder
    displayName?: SortOrder
    description?: SortOrder
    category?: SortOrder
    inputSchema?: SortOrder
    outputSchema?: SortOrder
    variableBindings?: SortOrder
    capabilities?: SortOrder
    defaultMaxTokens?: SortOrder
    defaultTemperature?: SortOrder
    schemaVersion?: SortOrder
    source?: SortOrder
    managedByCode?: SortOrder
    createdAt?: SortOrder
    updatedAt?: SortOrder
  }

  export type agent_definitionsSumOrderByAggregateInput = {
    defaultMaxTokens?: SortOrder
    defaultTemperature?: SortOrder
    schemaVersion?: SortOrder
  }

  export type orchestrator_definitionsCountOrderByAggregateInput = {
    id?: SortOrder
    displayName?: SortOrder
    description?: SortOrder
    category?: SortOrder
    steps?: SortOrder
    variableGraph?: SortOrder
    source?: SortOrder
    managedByCode?: SortOrder
    createdAt?: SortOrder
    updatedAt?: SortOrder
  }

  export type orchestrator_definitionsMaxOrderByAggregateInput = {
    id?: SortOrder
    displayName?: SortOrder
    description?: SortOrder
    category?: SortOrder
    steps?: SortOrder
    variableGraph?: SortOrder
    source?: SortOrder
    managedByCode?: SortOrder
    createdAt?: SortOrder
    updatedAt?: SortOrder
  }

  export type orchestrator_definitionsMinOrderByAggregateInput = {
    id?: SortOrder
    displayName?: SortOrder
    description?: SortOrder
    category?: SortOrder
    steps?: SortOrder
    variableGraph?: SortOrder
    source?: SortOrder
    managedByCode?: SortOrder
    createdAt?: SortOrder
    updatedAt?: SortOrder
  }

  export type agent_registrationsCountOrderByAggregateInput = {
    id?: SortOrder
    name?: SortOrder
    type?: SortOrder
    category?: SortOrder
    description?: SortOrder
    version?: SortOrder
    config?: SortOrder
    inputSchema?: SortOrder
    outputSchema?: SortOrder
    capabilities?: SortOrder
    subscribes?: SortOrder
    publishes?: SortOrder
    callCount?: SortOrder
    successRate?: SortOrder
    createdAt?: SortOrder
    updatedAt?: SortOrder
    endpoint?: SortOrder
  }

  export type agent_registrationsAvgOrderByAggregateInput = {
    callCount?: SortOrder
    successRate?: SortOrder
  }

  export type agent_registrationsMaxOrderByAggregateInput = {
    id?: SortOrder
    name?: SortOrder
    type?: SortOrder
    category?: SortOrder
    description?: SortOrder
    version?: SortOrder
    config?: SortOrder
    inputSchema?: SortOrder
    outputSchema?: SortOrder
    capabilities?: SortOrder
    subscribes?: SortOrder
    publishes?: SortOrder
    callCount?: SortOrder
    successRate?: SortOrder
    createdAt?: SortOrder
    updatedAt?: SortOrder
    endpoint?: SortOrder
  }

  export type agent_registrationsMinOrderByAggregateInput = {
    id?: SortOrder
    name?: SortOrder
    type?: SortOrder
    category?: SortOrder
    description?: SortOrder
    version?: SortOrder
    config?: SortOrder
    inputSchema?: SortOrder
    outputSchema?: SortOrder
    capabilities?: SortOrder
    subscribes?: SortOrder
    publishes?: SortOrder
    callCount?: SortOrder
    successRate?: SortOrder
    createdAt?: SortOrder
    updatedAt?: SortOrder
    endpoint?: SortOrder
  }

  export type agent_registrationsSumOrderByAggregateInput = {
    callCount?: SortOrder
    successRate?: SortOrder
  }

  export type BoolNullableFilter<$PrismaModel = never> = {
    equals?: boolean | BooleanFieldRefInput<$PrismaModel> | null
    not?: NestedBoolNullableFilter<$PrismaModel> | boolean | null
  }

  export type platform_api_configsCountOrderByAggregateInput = {
    id?: SortOrder
    apiUrl?: SortOrder
    apiKey?: SortOrder
    availableModels?: SortOrder
    defaultModel?: SortOrder
    defaultReasoningModel?: SortOrder
    defaultEvaluationModel?: SortOrder
    connectionStatus?: SortOrder
    lastCheckedAt?: SortOrder
    createdAt?: SortOrder
    updatedAt?: SortOrder
    defaultTemperature?: SortOrder
    defaultMaxTokens?: SortOrder
    reasoningEndpoint?: SortOrder
    lightEndpoint?: SortOrder
    chatModels?: SortOrder
    reasoningModels?: SortOrder
    lightModels?: SortOrder
    adminAccessMode?: SortOrder
    adminAllowedIps?: SortOrder
    allowPrivateNetwork?: SortOrder
    privateNetworkHosts?: SortOrder
  }

  export type platform_api_configsAvgOrderByAggregateInput = {
    defaultTemperature?: SortOrder
    defaultMaxTokens?: SortOrder
  }

  export type platform_api_configsMaxOrderByAggregateInput = {
    id?: SortOrder
    apiUrl?: SortOrder
    apiKey?: SortOrder
    availableModels?: SortOrder
    defaultModel?: SortOrder
    defaultReasoningModel?: SortOrder
    defaultEvaluationModel?: SortOrder
    connectionStatus?: SortOrder
    lastCheckedAt?: SortOrder
    createdAt?: SortOrder
    updatedAt?: SortOrder
    defaultTemperature?: SortOrder
    defaultMaxTokens?: SortOrder
    reasoningEndpoint?: SortOrder
    lightEndpoint?: SortOrder
    chatModels?: SortOrder
    reasoningModels?: SortOrder
    lightModels?: SortOrder
    adminAccessMode?: SortOrder
    adminAllowedIps?: SortOrder
    allowPrivateNetwork?: SortOrder
    privateNetworkHosts?: SortOrder
  }

  export type platform_api_configsMinOrderByAggregateInput = {
    id?: SortOrder
    apiUrl?: SortOrder
    apiKey?: SortOrder
    availableModels?: SortOrder
    defaultModel?: SortOrder
    defaultReasoningModel?: SortOrder
    defaultEvaluationModel?: SortOrder
    connectionStatus?: SortOrder
    lastCheckedAt?: SortOrder
    createdAt?: SortOrder
    updatedAt?: SortOrder
    defaultTemperature?: SortOrder
    defaultMaxTokens?: SortOrder
    reasoningEndpoint?: SortOrder
    lightEndpoint?: SortOrder
    chatModels?: SortOrder
    reasoningModels?: SortOrder
    lightModels?: SortOrder
    adminAccessMode?: SortOrder
    adminAllowedIps?: SortOrder
    allowPrivateNetwork?: SortOrder
    privateNetworkHosts?: SortOrder
  }

  export type platform_api_configsSumOrderByAggregateInput = {
    defaultTemperature?: SortOrder
    defaultMaxTokens?: SortOrder
  }

  export type BoolNullableWithAggregatesFilter<$PrismaModel = never> = {
    equals?: boolean | BooleanFieldRefInput<$PrismaModel> | null
    not?: NestedBoolNullableWithAggregatesFilter<$PrismaModel> | boolean | null
    _count?: NestedIntNullableFilter<$PrismaModel>
    _min?: NestedBoolNullableFilter<$PrismaModel>
    _max?: NestedBoolNullableFilter<$PrismaModel>
  }

  export type platform_settingsCountOrderByAggregateInput = {
    key?: SortOrder
    value?: SortOrder
    createdAt?: SortOrder
    updatedAt?: SortOrder
  }

  export type platform_settingsMaxOrderByAggregateInput = {
    key?: SortOrder
    value?: SortOrder
    createdAt?: SortOrder
    updatedAt?: SortOrder
  }

  export type platform_settingsMinOrderByAggregateInput = {
    key?: SortOrder
    value?: SortOrder
    createdAt?: SortOrder
    updatedAt?: SortOrder
  }

  export type skill_model_configsCountOrderByAggregateInput = {
    id?: SortOrder
    skillId?: SortOrder
    tier?: SortOrder
    model?: SortOrder
    thinkingMode?: SortOrder
    reasoningEffort?: SortOrder
    endpoint?: SortOrder
    apiKey?: SortOrder
    temperature?: SortOrder
    maxTokens?: SortOrder
    requestTimeoutMs?: SortOrder
    enabled?: SortOrder
    createdAt?: SortOrder
    updatedAt?: SortOrder
  }

  export type skill_model_configsAvgOrderByAggregateInput = {
    temperature?: SortOrder
    maxTokens?: SortOrder
    requestTimeoutMs?: SortOrder
  }

  export type skill_model_configsMaxOrderByAggregateInput = {
    id?: SortOrder
    skillId?: SortOrder
    tier?: SortOrder
    model?: SortOrder
    thinkingMode?: SortOrder
    reasoningEffort?: SortOrder
    endpoint?: SortOrder
    apiKey?: SortOrder
    temperature?: SortOrder
    maxTokens?: SortOrder
    requestTimeoutMs?: SortOrder
    enabled?: SortOrder
    createdAt?: SortOrder
    updatedAt?: SortOrder
  }

  export type skill_model_configsMinOrderByAggregateInput = {
    id?: SortOrder
    skillId?: SortOrder
    tier?: SortOrder
    model?: SortOrder
    thinkingMode?: SortOrder
    reasoningEffort?: SortOrder
    endpoint?: SortOrder
    apiKey?: SortOrder
    temperature?: SortOrder
    maxTokens?: SortOrder
    requestTimeoutMs?: SortOrder
    enabled?: SortOrder
    createdAt?: SortOrder
    updatedAt?: SortOrder
  }

  export type skill_model_configsSumOrderByAggregateInput = {
    temperature?: SortOrder
    maxTokens?: SortOrder
    requestTimeoutMs?: SortOrder
  }

  export type skill_registrationsCountOrderByAggregateInput = {
    id?: SortOrder
    name?: SortOrder
    version?: SortOrder
    category?: SortOrder
    description?: SortOrder
    inputSchema?: SortOrder
    outputSchema?: SortOrder
    endpoint?: SortOrder
    callCount?: SortOrder
    successRate?: SortOrder
    createdAt?: SortOrder
    updatedAt?: SortOrder
  }

  export type skill_registrationsAvgOrderByAggregateInput = {
    callCount?: SortOrder
    successRate?: SortOrder
  }

  export type skill_registrationsMaxOrderByAggregateInput = {
    id?: SortOrder
    name?: SortOrder
    version?: SortOrder
    category?: SortOrder
    description?: SortOrder
    inputSchema?: SortOrder
    outputSchema?: SortOrder
    endpoint?: SortOrder
    callCount?: SortOrder
    successRate?: SortOrder
    createdAt?: SortOrder
    updatedAt?: SortOrder
  }

  export type skill_registrationsMinOrderByAggregateInput = {
    id?: SortOrder
    name?: SortOrder
    version?: SortOrder
    category?: SortOrder
    description?: SortOrder
    inputSchema?: SortOrder
    outputSchema?: SortOrder
    endpoint?: SortOrder
    callCount?: SortOrder
    successRate?: SortOrder
    createdAt?: SortOrder
    updatedAt?: SortOrder
  }

  export type skill_registrationsSumOrderByAggregateInput = {
    callCount?: SortOrder
    successRate?: SortOrder
  }

  export type field_definitionsCountOrderByAggregateInput = {
    id?: SortOrder
    fieldId?: SortOrder
    stage?: SortOrder
    promptRole?: SortOrder
    valueType?: SortOrder
    snakeName?: SortOrder
    camelName?: SortOrder
    description?: SortOrder
    enumValues?: SortOrder
    schemaVersion?: SortOrder
    source?: SortOrder
    managedByCode?: SortOrder
    systemLocked?: SortOrder
    structureLocked?: SortOrder
    bindings?: SortOrder
    metadata?: SortOrder
    createdAt?: SortOrder
    updatedAt?: SortOrder
  }

  export type field_definitionsMaxOrderByAggregateInput = {
    id?: SortOrder
    fieldId?: SortOrder
    stage?: SortOrder
    promptRole?: SortOrder
    valueType?: SortOrder
    snakeName?: SortOrder
    camelName?: SortOrder
    description?: SortOrder
    enumValues?: SortOrder
    schemaVersion?: SortOrder
    source?: SortOrder
    managedByCode?: SortOrder
    systemLocked?: SortOrder
    structureLocked?: SortOrder
    bindings?: SortOrder
    metadata?: SortOrder
    createdAt?: SortOrder
    updatedAt?: SortOrder
  }

  export type field_definitionsMinOrderByAggregateInput = {
    id?: SortOrder
    fieldId?: SortOrder
    stage?: SortOrder
    promptRole?: SortOrder
    valueType?: SortOrder
    snakeName?: SortOrder
    camelName?: SortOrder
    description?: SortOrder
    enumValues?: SortOrder
    schemaVersion?: SortOrder
    source?: SortOrder
    managedByCode?: SortOrder
    systemLocked?: SortOrder
    structureLocked?: SortOrder
    bindings?: SortOrder
    metadata?: SortOrder
    createdAt?: SortOrder
    updatedAt?: SortOrder
  }

  export type agent_contractsCountOrderByAggregateInput = {
    id?: SortOrder
    agentId?: SortOrder
    stage?: SortOrder
    displayName?: SortOrder
    description?: SortOrder
    schemaVersion?: SortOrder
    source?: SortOrder
    managedByCode?: SortOrder
    metadata?: SortOrder
    createdAt?: SortOrder
    updatedAt?: SortOrder
  }

  export type agent_contractsMaxOrderByAggregateInput = {
    id?: SortOrder
    agentId?: SortOrder
    stage?: SortOrder
    displayName?: SortOrder
    description?: SortOrder
    schemaVersion?: SortOrder
    source?: SortOrder
    managedByCode?: SortOrder
    metadata?: SortOrder
    createdAt?: SortOrder
    updatedAt?: SortOrder
  }

  export type agent_contractsMinOrderByAggregateInput = {
    id?: SortOrder
    agentId?: SortOrder
    stage?: SortOrder
    displayName?: SortOrder
    description?: SortOrder
    schemaVersion?: SortOrder
    source?: SortOrder
    managedByCode?: SortOrder
    metadata?: SortOrder
    createdAt?: SortOrder
    updatedAt?: SortOrder
  }

  export type agent_field_routingsAgentIdFieldIdCompoundUniqueInput = {
    agentId: string
    fieldId: string
  }

  export type agent_field_routingsCountOrderByAggregateInput = {
    id?: SortOrder
    agentId?: SortOrder
    fieldId?: SortOrder
    render?: SortOrder
    handoff?: SortOrder
    internalFlag?: SortOrder
    accumulate?: SortOrder
    visibilityPreset?: SortOrder
    ordering?: SortOrder
    notes?: SortOrder
    source?: SortOrder
    managedByCode?: SortOrder
    systemLocked?: SortOrder
    structureLocked?: SortOrder
    createdAt?: SortOrder
    updatedAt?: SortOrder
  }

  export type agent_field_routingsAvgOrderByAggregateInput = {
    ordering?: SortOrder
  }

  export type agent_field_routingsMaxOrderByAggregateInput = {
    id?: SortOrder
    agentId?: SortOrder
    fieldId?: SortOrder
    render?: SortOrder
    handoff?: SortOrder
    internalFlag?: SortOrder
    accumulate?: SortOrder
    visibilityPreset?: SortOrder
    ordering?: SortOrder
    notes?: SortOrder
    source?: SortOrder
    managedByCode?: SortOrder
    systemLocked?: SortOrder
    structureLocked?: SortOrder
    createdAt?: SortOrder
    updatedAt?: SortOrder
  }

  export type agent_field_routingsMinOrderByAggregateInput = {
    id?: SortOrder
    agentId?: SortOrder
    fieldId?: SortOrder
    render?: SortOrder
    handoff?: SortOrder
    internalFlag?: SortOrder
    accumulate?: SortOrder
    visibilityPreset?: SortOrder
    ordering?: SortOrder
    notes?: SortOrder
    source?: SortOrder
    managedByCode?: SortOrder
    systemLocked?: SortOrder
    structureLocked?: SortOrder
    createdAt?: SortOrder
    updatedAt?: SortOrder
  }

  export type agent_field_routingsSumOrderByAggregateInput = {
    ordering?: SortOrder
  }

  export type node_config_changesCountOrderByAggregateInput = {
    id?: SortOrder
    changeType?: SortOrder
    targetTable?: SortOrder
    targetId?: SortOrder
    agentId?: SortOrder
    fieldId?: SortOrder
    before?: SortOrder
    after?: SortOrder
    actorId?: SortOrder
    actorRole?: SortOrder
    reason?: SortOrder
    createdAt?: SortOrder
  }

  export type node_config_changesMaxOrderByAggregateInput = {
    id?: SortOrder
    changeType?: SortOrder
    targetTable?: SortOrder
    targetId?: SortOrder
    agentId?: SortOrder
    fieldId?: SortOrder
    before?: SortOrder
    after?: SortOrder
    actorId?: SortOrder
    actorRole?: SortOrder
    reason?: SortOrder
    createdAt?: SortOrder
  }

  export type node_config_changesMinOrderByAggregateInput = {
    id?: SortOrder
    changeType?: SortOrder
    targetTable?: SortOrder
    targetId?: SortOrder
    agentId?: SortOrder
    fieldId?: SortOrder
    before?: SortOrder
    after?: SortOrder
    actorId?: SortOrder
    actorRole?: SortOrder
    reason?: SortOrder
    createdAt?: SortOrder
  }

  export type prompt_eval_casesAgentIdCaseIdCompoundUniqueInput = {
    agentId: string
    caseId: string
  }

  export type prompt_eval_casesCountOrderByAggregateInput = {
    id?: SortOrder
    agentId?: SortOrder
    caseId?: SortOrder
    name?: SortOrder
    description?: SortOrder
    messagesJson?: SortOrder
    previousStateJson?: SortOrder
    expectationsJson?: SortOrder
    enabled?: SortOrder
    createdBy?: SortOrder
    createdAt?: SortOrder
    updatedAt?: SortOrder
  }

  export type prompt_eval_casesMaxOrderByAggregateInput = {
    id?: SortOrder
    agentId?: SortOrder
    caseId?: SortOrder
    name?: SortOrder
    description?: SortOrder
    messagesJson?: SortOrder
    previousStateJson?: SortOrder
    expectationsJson?: SortOrder
    enabled?: SortOrder
    createdBy?: SortOrder
    createdAt?: SortOrder
    updatedAt?: SortOrder
  }

  export type prompt_eval_casesMinOrderByAggregateInput = {
    id?: SortOrder
    agentId?: SortOrder
    caseId?: SortOrder
    name?: SortOrder
    description?: SortOrder
    messagesJson?: SortOrder
    previousStateJson?: SortOrder
    expectationsJson?: SortOrder
    enabled?: SortOrder
    createdBy?: SortOrder
    createdAt?: SortOrder
    updatedAt?: SortOrder
  }

  export type prompt_eval_runsCountOrderByAggregateInput = {
    id?: SortOrder
    agentId?: SortOrder
    promptVersionId?: SortOrder
    promptVersion?: SortOrder
    promptSource?: SortOrder
    mode?: SortOrder
    caseCount?: SortOrder
    totalRuns?: SortOrder
    summaryJson?: SortOrder
    resultsJson?: SortOrder
    durationMs?: SortOrder
    triggeredBy?: SortOrder
    createdAt?: SortOrder
  }

  export type prompt_eval_runsAvgOrderByAggregateInput = {
    promptVersion?: SortOrder
    caseCount?: SortOrder
    totalRuns?: SortOrder
    durationMs?: SortOrder
  }

  export type prompt_eval_runsMaxOrderByAggregateInput = {
    id?: SortOrder
    agentId?: SortOrder
    promptVersionId?: SortOrder
    promptVersion?: SortOrder
    promptSource?: SortOrder
    mode?: SortOrder
    caseCount?: SortOrder
    totalRuns?: SortOrder
    summaryJson?: SortOrder
    resultsJson?: SortOrder
    durationMs?: SortOrder
    triggeredBy?: SortOrder
    createdAt?: SortOrder
  }

  export type prompt_eval_runsMinOrderByAggregateInput = {
    id?: SortOrder
    agentId?: SortOrder
    promptVersionId?: SortOrder
    promptVersion?: SortOrder
    promptSource?: SortOrder
    mode?: SortOrder
    caseCount?: SortOrder
    totalRuns?: SortOrder
    summaryJson?: SortOrder
    resultsJson?: SortOrder
    durationMs?: SortOrder
    triggeredBy?: SortOrder
    createdAt?: SortOrder
  }

  export type prompt_eval_runsSumOrderByAggregateInput = {
    promptVersion?: SortOrder
    caseCount?: SortOrder
    totalRuns?: SortOrder
    durationMs?: SortOrder
  }

  export type StringFieldUpdateOperationsInput = {
    set?: string
  }

  export type NullableStringFieldUpdateOperationsInput = {
    set?: string | null
  }

  export type NullableFloatFieldUpdateOperationsInput = {
    set?: number | null
    increment?: number
    decrement?: number
    multiply?: number
    divide?: number
  }

  export type NullableIntFieldUpdateOperationsInput = {
    set?: number | null
    increment?: number
    decrement?: number
    multiply?: number
    divide?: number
  }

  export type DateTimeFieldUpdateOperationsInput = {
    set?: Date | string
  }

  export type FloatFieldUpdateOperationsInput = {
    set?: number
    increment?: number
    decrement?: number
    multiply?: number
    divide?: number
  }

  export type IntFieldUpdateOperationsInput = {
    set?: number
    increment?: number
    decrement?: number
    multiply?: number
    divide?: number
  }

  export type BoolFieldUpdateOperationsInput = {
    set?: boolean
  }

  export type NullableDateTimeFieldUpdateOperationsInput = {
    set?: Date | string | null
  }

  export type NullableBoolFieldUpdateOperationsInput = {
    set?: boolean | null
  }

  export type NestedStringFilter<$PrismaModel = never> = {
    equals?: string | StringFieldRefInput<$PrismaModel>
    in?: string[]
    notIn?: string[]
    lt?: string | StringFieldRefInput<$PrismaModel>
    lte?: string | StringFieldRefInput<$PrismaModel>
    gt?: string | StringFieldRefInput<$PrismaModel>
    gte?: string | StringFieldRefInput<$PrismaModel>
    contains?: string | StringFieldRefInput<$PrismaModel>
    startsWith?: string | StringFieldRefInput<$PrismaModel>
    endsWith?: string | StringFieldRefInput<$PrismaModel>
    not?: NestedStringFilter<$PrismaModel> | string
  }

  export type NestedStringNullableFilter<$PrismaModel = never> = {
    equals?: string | StringFieldRefInput<$PrismaModel> | null
    in?: string[] | null
    notIn?: string[] | null
    lt?: string | StringFieldRefInput<$PrismaModel>
    lte?: string | StringFieldRefInput<$PrismaModel>
    gt?: string | StringFieldRefInput<$PrismaModel>
    gte?: string | StringFieldRefInput<$PrismaModel>
    contains?: string | StringFieldRefInput<$PrismaModel>
    startsWith?: string | StringFieldRefInput<$PrismaModel>
    endsWith?: string | StringFieldRefInput<$PrismaModel>
    not?: NestedStringNullableFilter<$PrismaModel> | string | null
  }

  export type NestedFloatNullableFilter<$PrismaModel = never> = {
    equals?: number | FloatFieldRefInput<$PrismaModel> | null
    in?: number[] | null
    notIn?: number[] | null
    lt?: number | FloatFieldRefInput<$PrismaModel>
    lte?: number | FloatFieldRefInput<$PrismaModel>
    gt?: number | FloatFieldRefInput<$PrismaModel>
    gte?: number | FloatFieldRefInput<$PrismaModel>
    not?: NestedFloatNullableFilter<$PrismaModel> | number | null
  }

  export type NestedIntNullableFilter<$PrismaModel = never> = {
    equals?: number | IntFieldRefInput<$PrismaModel> | null
    in?: number[] | null
    notIn?: number[] | null
    lt?: number | IntFieldRefInput<$PrismaModel>
    lte?: number | IntFieldRefInput<$PrismaModel>
    gt?: number | IntFieldRefInput<$PrismaModel>
    gte?: number | IntFieldRefInput<$PrismaModel>
    not?: NestedIntNullableFilter<$PrismaModel> | number | null
  }

  export type NestedDateTimeFilter<$PrismaModel = never> = {
    equals?: Date | string | DateTimeFieldRefInput<$PrismaModel>
    in?: Date[] | string[]
    notIn?: Date[] | string[]
    lt?: Date | string | DateTimeFieldRefInput<$PrismaModel>
    lte?: Date | string | DateTimeFieldRefInput<$PrismaModel>
    gt?: Date | string | DateTimeFieldRefInput<$PrismaModel>
    gte?: Date | string | DateTimeFieldRefInput<$PrismaModel>
    not?: NestedDateTimeFilter<$PrismaModel> | Date | string
  }

  export type NestedStringWithAggregatesFilter<$PrismaModel = never> = {
    equals?: string | StringFieldRefInput<$PrismaModel>
    in?: string[]
    notIn?: string[]
    lt?: string | StringFieldRefInput<$PrismaModel>
    lte?: string | StringFieldRefInput<$PrismaModel>
    gt?: string | StringFieldRefInput<$PrismaModel>
    gte?: string | StringFieldRefInput<$PrismaModel>
    contains?: string | StringFieldRefInput<$PrismaModel>
    startsWith?: string | StringFieldRefInput<$PrismaModel>
    endsWith?: string | StringFieldRefInput<$PrismaModel>
    not?: NestedStringWithAggregatesFilter<$PrismaModel> | string
    _count?: NestedIntFilter<$PrismaModel>
    _min?: NestedStringFilter<$PrismaModel>
    _max?: NestedStringFilter<$PrismaModel>
  }

  export type NestedIntFilter<$PrismaModel = never> = {
    equals?: number | IntFieldRefInput<$PrismaModel>
    in?: number[]
    notIn?: number[]
    lt?: number | IntFieldRefInput<$PrismaModel>
    lte?: number | IntFieldRefInput<$PrismaModel>
    gt?: number | IntFieldRefInput<$PrismaModel>
    gte?: number | IntFieldRefInput<$PrismaModel>
    not?: NestedIntFilter<$PrismaModel> | number
  }

  export type NestedStringNullableWithAggregatesFilter<$PrismaModel = never> = {
    equals?: string | StringFieldRefInput<$PrismaModel> | null
    in?: string[] | null
    notIn?: string[] | null
    lt?: string | StringFieldRefInput<$PrismaModel>
    lte?: string | StringFieldRefInput<$PrismaModel>
    gt?: string | StringFieldRefInput<$PrismaModel>
    gte?: string | StringFieldRefInput<$PrismaModel>
    contains?: string | StringFieldRefInput<$PrismaModel>
    startsWith?: string | StringFieldRefInput<$PrismaModel>
    endsWith?: string | StringFieldRefInput<$PrismaModel>
    not?: NestedStringNullableWithAggregatesFilter<$PrismaModel> | string | null
    _count?: NestedIntNullableFilter<$PrismaModel>
    _min?: NestedStringNullableFilter<$PrismaModel>
    _max?: NestedStringNullableFilter<$PrismaModel>
  }

  export type NestedFloatNullableWithAggregatesFilter<$PrismaModel = never> = {
    equals?: number | FloatFieldRefInput<$PrismaModel> | null
    in?: number[] | null
    notIn?: number[] | null
    lt?: number | FloatFieldRefInput<$PrismaModel>
    lte?: number | FloatFieldRefInput<$PrismaModel>
    gt?: number | FloatFieldRefInput<$PrismaModel>
    gte?: number | FloatFieldRefInput<$PrismaModel>
    not?: NestedFloatNullableWithAggregatesFilter<$PrismaModel> | number | null
    _count?: NestedIntNullableFilter<$PrismaModel>
    _avg?: NestedFloatNullableFilter<$PrismaModel>
    _sum?: NestedFloatNullableFilter<$PrismaModel>
    _min?: NestedFloatNullableFilter<$PrismaModel>
    _max?: NestedFloatNullableFilter<$PrismaModel>
  }

  export type NestedIntNullableWithAggregatesFilter<$PrismaModel = never> = {
    equals?: number | IntFieldRefInput<$PrismaModel> | null
    in?: number[] | null
    notIn?: number[] | null
    lt?: number | IntFieldRefInput<$PrismaModel>
    lte?: number | IntFieldRefInput<$PrismaModel>
    gt?: number | IntFieldRefInput<$PrismaModel>
    gte?: number | IntFieldRefInput<$PrismaModel>
    not?: NestedIntNullableWithAggregatesFilter<$PrismaModel> | number | null
    _count?: NestedIntNullableFilter<$PrismaModel>
    _avg?: NestedFloatNullableFilter<$PrismaModel>
    _sum?: NestedIntNullableFilter<$PrismaModel>
    _min?: NestedIntNullableFilter<$PrismaModel>
    _max?: NestedIntNullableFilter<$PrismaModel>
  }

  export type NestedDateTimeWithAggregatesFilter<$PrismaModel = never> = {
    equals?: Date | string | DateTimeFieldRefInput<$PrismaModel>
    in?: Date[] | string[]
    notIn?: Date[] | string[]
    lt?: Date | string | DateTimeFieldRefInput<$PrismaModel>
    lte?: Date | string | DateTimeFieldRefInput<$PrismaModel>
    gt?: Date | string | DateTimeFieldRefInput<$PrismaModel>
    gte?: Date | string | DateTimeFieldRefInput<$PrismaModel>
    not?: NestedDateTimeWithAggregatesFilter<$PrismaModel> | Date | string
    _count?: NestedIntFilter<$PrismaModel>
    _min?: NestedDateTimeFilter<$PrismaModel>
    _max?: NestedDateTimeFilter<$PrismaModel>
  }

  export type NestedFloatFilter<$PrismaModel = never> = {
    equals?: number | FloatFieldRefInput<$PrismaModel>
    in?: number[]
    notIn?: number[]
    lt?: number | FloatFieldRefInput<$PrismaModel>
    lte?: number | FloatFieldRefInput<$PrismaModel>
    gt?: number | FloatFieldRefInput<$PrismaModel>
    gte?: number | FloatFieldRefInput<$PrismaModel>
    not?: NestedFloatFilter<$PrismaModel> | number
  }

  export type NestedBoolFilter<$PrismaModel = never> = {
    equals?: boolean | BooleanFieldRefInput<$PrismaModel>
    not?: NestedBoolFilter<$PrismaModel> | boolean
  }

  export type NestedFloatWithAggregatesFilter<$PrismaModel = never> = {
    equals?: number | FloatFieldRefInput<$PrismaModel>
    in?: number[]
    notIn?: number[]
    lt?: number | FloatFieldRefInput<$PrismaModel>
    lte?: number | FloatFieldRefInput<$PrismaModel>
    gt?: number | FloatFieldRefInput<$PrismaModel>
    gte?: number | FloatFieldRefInput<$PrismaModel>
    not?: NestedFloatWithAggregatesFilter<$PrismaModel> | number
    _count?: NestedIntFilter<$PrismaModel>
    _avg?: NestedFloatFilter<$PrismaModel>
    _sum?: NestedFloatFilter<$PrismaModel>
    _min?: NestedFloatFilter<$PrismaModel>
    _max?: NestedFloatFilter<$PrismaModel>
  }

  export type NestedIntWithAggregatesFilter<$PrismaModel = never> = {
    equals?: number | IntFieldRefInput<$PrismaModel>
    in?: number[]
    notIn?: number[]
    lt?: number | IntFieldRefInput<$PrismaModel>
    lte?: number | IntFieldRefInput<$PrismaModel>
    gt?: number | IntFieldRefInput<$PrismaModel>
    gte?: number | IntFieldRefInput<$PrismaModel>
    not?: NestedIntWithAggregatesFilter<$PrismaModel> | number
    _count?: NestedIntFilter<$PrismaModel>
    _avg?: NestedFloatFilter<$PrismaModel>
    _sum?: NestedIntFilter<$PrismaModel>
    _min?: NestedIntFilter<$PrismaModel>
    _max?: NestedIntFilter<$PrismaModel>
  }

  export type NestedBoolWithAggregatesFilter<$PrismaModel = never> = {
    equals?: boolean | BooleanFieldRefInput<$PrismaModel>
    not?: NestedBoolWithAggregatesFilter<$PrismaModel> | boolean
    _count?: NestedIntFilter<$PrismaModel>
    _min?: NestedBoolFilter<$PrismaModel>
    _max?: NestedBoolFilter<$PrismaModel>
  }

  export type NestedDateTimeNullableFilter<$PrismaModel = never> = {
    equals?: Date | string | DateTimeFieldRefInput<$PrismaModel> | null
    in?: Date[] | string[] | null
    notIn?: Date[] | string[] | null
    lt?: Date | string | DateTimeFieldRefInput<$PrismaModel>
    lte?: Date | string | DateTimeFieldRefInput<$PrismaModel>
    gt?: Date | string | DateTimeFieldRefInput<$PrismaModel>
    gte?: Date | string | DateTimeFieldRefInput<$PrismaModel>
    not?: NestedDateTimeNullableFilter<$PrismaModel> | Date | string | null
  }

  export type NestedDateTimeNullableWithAggregatesFilter<$PrismaModel = never> = {
    equals?: Date | string | DateTimeFieldRefInput<$PrismaModel> | null
    in?: Date[] | string[] | null
    notIn?: Date[] | string[] | null
    lt?: Date | string | DateTimeFieldRefInput<$PrismaModel>
    lte?: Date | string | DateTimeFieldRefInput<$PrismaModel>
    gt?: Date | string | DateTimeFieldRefInput<$PrismaModel>
    gte?: Date | string | DateTimeFieldRefInput<$PrismaModel>
    not?: NestedDateTimeNullableWithAggregatesFilter<$PrismaModel> | Date | string | null
    _count?: NestedIntNullableFilter<$PrismaModel>
    _min?: NestedDateTimeNullableFilter<$PrismaModel>
    _max?: NestedDateTimeNullableFilter<$PrismaModel>
  }

  export type NestedBoolNullableFilter<$PrismaModel = never> = {
    equals?: boolean | BooleanFieldRefInput<$PrismaModel> | null
    not?: NestedBoolNullableFilter<$PrismaModel> | boolean | null
  }

  export type NestedBoolNullableWithAggregatesFilter<$PrismaModel = never> = {
    equals?: boolean | BooleanFieldRefInput<$PrismaModel> | null
    not?: NestedBoolNullableWithAggregatesFilter<$PrismaModel> | boolean | null
    _count?: NestedIntNullableFilter<$PrismaModel>
    _min?: NestedBoolNullableFilter<$PrismaModel>
    _max?: NestedBoolNullableFilter<$PrismaModel>
  }



  /**
   * Aliases for legacy arg types
   */
    /**
     * @deprecated Use agent_lab_configsDefaultArgs instead
     */
    export type agent_lab_configsArgs<ExtArgs extends $Extensions.InternalArgs = $Extensions.DefaultArgs> = agent_lab_configsDefaultArgs<ExtArgs>
    /**
     * @deprecated Use agent_model_configsDefaultArgs instead
     */
    export type agent_model_configsArgs<ExtArgs extends $Extensions.InternalArgs = $Extensions.DefaultArgs> = agent_model_configsDefaultArgs<ExtArgs>
    /**
     * @deprecated Use agent_promptsDefaultArgs instead
     */
    export type agent_promptsArgs<ExtArgs extends $Extensions.InternalArgs = $Extensions.DefaultArgs> = agent_promptsDefaultArgs<ExtArgs>
    /**
     * @deprecated Use agent_definitionsDefaultArgs instead
     */
    export type agent_definitionsArgs<ExtArgs extends $Extensions.InternalArgs = $Extensions.DefaultArgs> = agent_definitionsDefaultArgs<ExtArgs>
    /**
     * @deprecated Use orchestrator_definitionsDefaultArgs instead
     */
    export type orchestrator_definitionsArgs<ExtArgs extends $Extensions.InternalArgs = $Extensions.DefaultArgs> = orchestrator_definitionsDefaultArgs<ExtArgs>
    /**
     * @deprecated Use agent_registrationsDefaultArgs instead
     */
    export type agent_registrationsArgs<ExtArgs extends $Extensions.InternalArgs = $Extensions.DefaultArgs> = agent_registrationsDefaultArgs<ExtArgs>
    /**
     * @deprecated Use platform_api_configsDefaultArgs instead
     */
    export type platform_api_configsArgs<ExtArgs extends $Extensions.InternalArgs = $Extensions.DefaultArgs> = platform_api_configsDefaultArgs<ExtArgs>
    /**
     * @deprecated Use platform_settingsDefaultArgs instead
     */
    export type platform_settingsArgs<ExtArgs extends $Extensions.InternalArgs = $Extensions.DefaultArgs> = platform_settingsDefaultArgs<ExtArgs>
    /**
     * @deprecated Use skill_model_configsDefaultArgs instead
     */
    export type skill_model_configsArgs<ExtArgs extends $Extensions.InternalArgs = $Extensions.DefaultArgs> = skill_model_configsDefaultArgs<ExtArgs>
    /**
     * @deprecated Use skill_registrationsDefaultArgs instead
     */
    export type skill_registrationsArgs<ExtArgs extends $Extensions.InternalArgs = $Extensions.DefaultArgs> = skill_registrationsDefaultArgs<ExtArgs>
    /**
     * @deprecated Use field_definitionsDefaultArgs instead
     */
    export type field_definitionsArgs<ExtArgs extends $Extensions.InternalArgs = $Extensions.DefaultArgs> = field_definitionsDefaultArgs<ExtArgs>
    /**
     * @deprecated Use agent_contractsDefaultArgs instead
     */
    export type agent_contractsArgs<ExtArgs extends $Extensions.InternalArgs = $Extensions.DefaultArgs> = agent_contractsDefaultArgs<ExtArgs>
    /**
     * @deprecated Use agent_field_routingsDefaultArgs instead
     */
    export type agent_field_routingsArgs<ExtArgs extends $Extensions.InternalArgs = $Extensions.DefaultArgs> = agent_field_routingsDefaultArgs<ExtArgs>
    /**
     * @deprecated Use node_config_changesDefaultArgs instead
     */
    export type node_config_changesArgs<ExtArgs extends $Extensions.InternalArgs = $Extensions.DefaultArgs> = node_config_changesDefaultArgs<ExtArgs>
    /**
     * @deprecated Use prompt_eval_casesDefaultArgs instead
     */
    export type prompt_eval_casesArgs<ExtArgs extends $Extensions.InternalArgs = $Extensions.DefaultArgs> = prompt_eval_casesDefaultArgs<ExtArgs>
    /**
     * @deprecated Use prompt_eval_runsDefaultArgs instead
     */
    export type prompt_eval_runsArgs<ExtArgs extends $Extensions.InternalArgs = $Extensions.DefaultArgs> = prompt_eval_runsDefaultArgs<ExtArgs>

  /**
   * Batch Payload for updateMany & deleteMany & createMany
   */

  export type BatchPayload = {
    count: number
  }

  /**
   * DMMF
   */
  export const dmmf: runtime.BaseDMMF
}