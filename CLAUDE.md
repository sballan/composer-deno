# TypeScript & Deno Best Practices

This document outlines the coding standards and best practices for this project.

## TypeScript Best Practices

### 1. Avoid Enums - Use Const Objects Instead

**Use const objects with `as const` instead:**

```typescript
// ❌ BAD: Using enum
enum Direction {
  Up = "UP",
  Down = "DOWN",
}

// ✅ GOOD: Using const object
export const Direction = {
  Up: "UP",
  Down: "DOWN",
} as const;

export type Direction = typeof Direction[keyof typeof Direction];
```

### 2. Use Union Types for String Literals

```typescript
// ✅ GOOD: Simple string union
export type Status = "pending" | "success" | "error";
```

### 3. Use `const` Assertions

```typescript
// ✅ GOOD: Const assertion for literal types
const CONFIG = {
  maxRetries: 3,
  timeout: 5000,
} as const;
```

### 4. Prefer Type Aliases Over Interfaces for Object Shapes

```typescript
// ✅ GOOD: Type alias (more flexible)
export type User = {
  id: string;
  name: string;
};

// Use interfaces only for:
// - Public API contracts
// - When you need declaration merging
// - When you need extends/implements
```

### 5. Use Discriminated Unions

```typescript
// ✅ GOOD: Discriminated union
type Success = { status: "success"; data: string };
type Error = { status: "error"; error: string };
type Result = Success | Error;

function handle(result: Result) {
  if (result.status === "success") {
    // TypeScript knows result.data exists
    console.log(result.data);
  }
}
```

## Deno Best Practices

### 1. Always Use File Extensions in Imports

```typescript
// ❌ BAD
import { foo } from "./module";

// ✅ GOOD
import { foo } from "./module.ts";
```

### 2. Use Import Maps in deno.json (Recommended)

**Best Practice**: Centralize version management in `deno.json` rather than
versioning imports throughout your code.

```json
// deno.json
{
  "imports": {
    "@std/assert": "jsr:@std/assert@^1.0.12",
    "@std/path": "jsr:@std/path@^1.0.0",
    "some-package": "npm:some-package@^2.0.0"
  }
}
```

```typescript
// ✅ GOOD: Use import map (clean, centralized versioning)
import { assertEquals } from "@std/assert";
import { join } from "@std/path";

// ❌ BAD: Direct versioned imports (harder to maintain)
import { assertEquals } from "jsr:@std/assert@1.0.12";

// ❌ BAD: No version (fails lint)
import { assertEquals } from "jsr:@std/assert";
```

### 3. Prefer JSR Over NPM When Available

```typescript
// ✅ GOOD: Add JSR packages to import map
"@std/assert": "jsr:@std/assert@^1.0.12"

// ⚠️  OK: NPM packages when JSR not available
"lodash": "npm:lodash@^4.17.21"
```

### 4. Use Explicit Export Types

```typescript
// ✅ GOOD: Clear what's exported
export type { User };
export { createUser };
```

### 5. Organize Imports

Order: std library → third party → local

```typescript
// ✅ GOOD: Organized imports (using import map)
import { assertEquals } from "@std/assert";
import { serve } from "@std/http";

import { parse } from "yaml";

import { helper } from "./helper.ts";
import type { Config } from "./types.ts";
```

### 6. Use Deno's Built-in APIs

Prefer web standard and Deno APIs over Node.js polyfills:

```typescript
// ✅ GOOD: Use Deno APIs
await Deno.readFile("file.txt");
Deno.env.get("HOME");

// ❌ BAD: Node.js APIs (avoid unless necessary)
import * as fs from "node:fs";
```

### 7. Type Your Tests

```typescript
// ✅ GOOD: Tests are typed
Deno.test("should parse correctly", () => {
  const result: number = parseInt("42");
  assertEquals(result, 42);
});
```

## General Code Quality Practices

### 1. Prefer Immutability

```typescript
// ✅ GOOD: Use const, readonly, as const
const users = [...existingUsers, newUser];

type User = {
  readonly id: string;
  readonly name: string;
};
```

### 2. Use Type Guards

```typescript
// ✅ GOOD: Type guard function
function isString(value: unknown): value is string {
  return typeof value === "string";
}
```

### 3. Avoid `any` - Use `unknown` Instead

```typescript
// ❌ BAD
function process(data: any) {
  return data.value;
}

// ✅ GOOD
function process(data: unknown) {
  if (typeof data === "object" && data !== null && "value" in data) {
    return (data as { value: unknown }).value;
  }
  throw new Error("Invalid data");
}
```

### 4. Use Branded Types for Nominal Typing

```typescript
// ✅ GOOD: Branded type for IDs
type UserId = string & { readonly __brand: "UserId" };
type ProductId = string & { readonly __brand: "ProductId" };

function getUserById(id: UserId) {
  // ...
}

// This prevents mixing up different ID types
```

### 5. Document Complex Types

```typescript
/**
 * Represents a MIDI event with timing information.
 * Delta time is measured in ticks since the last event.
 */
export type MIDIEvent = {
  /** Ticks since last event */
  deltaTime: number;
  /** Event type identifier */
  type: number;
};
```

## Project-Specific Guidelines

### 1. File Organization

```
lib/           - Core library code
  types.ts     - Type definitions
  module.ts    - Implementation
  module.test.ts - Tests alongside implementation
```

### 2. Naming Conventions

- **Files**: `kebab-case.ts` (e.g., `midi-reader.ts`)
- **Types**: `PascalCase` (e.g., `MIDIEvent`)
- **Functions/Variables**: `camelCase` (e.g., `parseEvent`)
- **Constants**: `UPPER_CASE` for truly constant values (e.g., `MAX_RETRY`)
- **Const objects**: `PascalCase` when used as enum replacement (e.g.,
  `EventType`)

### 3. Testing

- Test files should be co-located with source: `module.test.ts`
- Use descriptive test names: `"MIDIReader - parse header correctly"`
- Group related tests logically
- Test both happy path and error cases

### 4. Error Handling

```typescript
// ✅ GOOD: Descriptive errors
if (chunkType !== "MThd") {
  throw new Error(`Invalid MIDI file: expected MThd, got ${chunkType}`);
}
```

## References

- [Deno Style Guide](https://docs.deno.com/runtime/fundamentals/style_guide/)
- [TypeScript Do's and Don'ts](https://www.typescriptlang.org/docs/handbook/declaration-files/do-s-and-don-ts.html)
- [Google TypeScript Style Guide](https://google.github.io/styleguide/tsguide.html)
