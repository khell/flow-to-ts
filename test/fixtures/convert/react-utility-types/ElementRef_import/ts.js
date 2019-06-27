import React, { RefObject } from "react";

const MyComponent = () => <div>Hello World</div>;

type MyRef1 = RefObject<Element> | null;
type MyRef2 = RefObject<HTMLElement> | null;
type MyRef3 = RefObject<typeof MyComponent> | null;