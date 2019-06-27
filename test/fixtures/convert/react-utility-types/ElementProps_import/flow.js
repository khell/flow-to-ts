// @flow
import React, { type ElementProps } from 'react';

type Props = {|
    foo: string;
    bar: string;
|};

const FooComponent = ({ foo, bar }: Props) => (
    <div>{foo} - {bar}</div>
);

const BarComponent = ({ foo, bar }: ElementProps<typeof FooComponent>) => (
    <span>{foo} - {bar}</span>
)

export default BarComponent;