
import React, { ComponentProps, memo } from "react";

type Props = {
  foo: string;
  bar: string;
};

const FooComponent = ({
  foo,
  bar
}: Props) => <div>{foo} - {bar}</div>;

FooComponent.defaultProps = {
  bar: 'foo'
};

export default memo<JSX.LibraryManagedAttributes<typeof FooComponent, ComponentProps<typeof FooComponent>>>(FooComponent);