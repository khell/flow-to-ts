import { Brand } from "utility-types";

export type Foo = Brand<string, "Foo">;

export const bar: Foo = ("foobar" as Foo);