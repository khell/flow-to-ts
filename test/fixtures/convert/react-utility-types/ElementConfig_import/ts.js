import { $Diff } from "utility-types";

import React, { ComponentProps, ComponentType, memo } from "react";

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

const withRouter = <P extends {}, C extends ComponentType<P>>(WrappedComponent: C): ComponentType<$Diff<JSX.LibraryManagedAttributes<C, ComponentProps<C>>, {}>> => {};