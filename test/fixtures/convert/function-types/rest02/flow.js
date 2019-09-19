// The rest spread parameter is untyped which is invalid syntax
// This test case is expected to fail
type Foo = (...rest) => string | boolean[];