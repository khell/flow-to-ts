import React, { type ElementRef } from 'react';

const MyComponent = () => <div>Hello World</div>;

type MyRef1 = ElementRef<'div'> | null;
type MyRef2 = ElementRef<HTMLElement> | null;
type MyRef3 = ElementRef<typeof MyComponent> | null;
type MyRef4 = ElementRef<any> | null;