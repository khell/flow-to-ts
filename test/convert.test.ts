import fs from "fs";
import path from "path";
import convert from "../src/convert";

const skipTestNames = ["spread03", "spread04"];
const expectedFailingTests = ["function-types/rest02"];

describe("convert", () => {
  const suites = fs.readdirSync(path.join(__dirname, "fixtures/convert"));

  for (const suiteName of suites) {
    describe(suiteName, () => {
      const tests = fs
        .readdirSync(path.join(__dirname, "fixtures/convert", suiteName))
        .filter(testName => !skipTestNames.includes(testName));

      for (const testName of tests) {
        const dir = path.join(
          __dirname,
          "fixtures/convert",
          suiteName,
          testName
        );
        const flowCode = fs.readFileSync(path.join(dir, "flow.js"), "utf-8");
        const tsCode = fs.readFileSync(path.join(dir, "ts.js"), "utf-8");
        const hasOptions = fs.existsSync(path.join(dir, "options.json"));

        const options = hasOptions
          ? JSON.parse(fs.readFileSync(path.join(dir, "options.json"), "utf-8"))
          : undefined;

        test(testName.replace(/_/g, " "), () => {
          try {
            const { code } = convert(flowCode, options);
            expect(code).toEqual(tsCode);
          } catch (error) {
            expect(expectedFailingTests).toContain(`${suiteName}/${testName}`);
          }
        });
      }
    });
  }
});
