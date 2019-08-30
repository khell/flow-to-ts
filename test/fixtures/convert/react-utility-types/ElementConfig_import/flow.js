// @flow
import React, { type ElementConfig, type ComponentType, memo } from 'react';

type Props = {|
    foo: string;
    bar: string;
|};

const FooComponent = ({ foo, bar }: Props) => (
    <div>{foo} - {bar}</div>
);

FooComponent.defaultProps = {
    bar: 'foo'
};

export default memo<ElementConfig<typeof FooComponent>>(FooComponent);

const withRouter = <P: {}, C: ComponentType<P>>(
    WrappedComponent: C,
): ComponentType<$Diff<ElementConfig<C>, {}>> => {}