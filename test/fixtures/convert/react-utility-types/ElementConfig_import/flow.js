// @flow
import React, { type ElementConfig, memo } from 'react';

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