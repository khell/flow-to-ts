import fs from "fs";
import path from "path";
import tmp from "tmp";
import fsReadDirRecursive from "fs-readdir-recursive";
import { mockProcessExit, mockProcessStdout } from "jest-mock-process";
import mockConsole from "jest-mock-console";
import colors from "colors/safe";

const interrupt = jest.fn();
const tick = jest.fn();
jest.mock(
  "progress",
  () =>
    class ProgressBar {
      interrupt() {
        interrupt(...arguments);
      }
      tick() {
        tick(...arguments);
      }
    }
);

import cli from "../src/cli";

// cleanup temp dir automatically in case of an exception
tmp.setGracefulCleanup();

describe("cli", () => {
  const fixturesPath = path.join(__dirname, "fixtures", "cli");
  const flowToTsPath = path.join(__dirname, "../dist/src/flow-to-ts.js");

  let mockExit: ReturnType<typeof mockProcessExit>;
  let mockStdout: ReturnType<typeof mockProcessStdout>;
  let unmockConsole: ReturnType<typeof mockConsole>;
  let tmpobj: ReturnType<typeof tmp.dirSync>;
  let tmpdir: string;

  beforeAll(() => {
    mockExit = mockProcessExit();
    mockStdout = mockProcessStdout();
    unmockConsole = mockConsole();
  });

  beforeEach(() => {
    tmpobj = tmp.dirSync();
    tmpdir = tmpobj.name;
    interrupt.mockClear();
    tick.mockClear();
  });

  afterEach(() => {
    // cleanup temp dir
    tmpobj.removeCallback();
  });

  afterAll(() => {
    mockExit.mockRestore();
    mockStdout.mockRestore();
    unmockConsole();
  });

  it("should exit with code one when no files have been provided", () => {
    // Act
    cli(["node", flowToTsPath]);

    // Assert
    expect(mockExit).toHaveBeenCalledWith(1);
  });

  it("should output transpiled code via ProgressBar interrupt if logLevel allows it", () => {
    // Arrange
    const inputPath = path.join(tmpdir, "test.js");
    fs.writeFileSync(inputPath, "const a: number = 5;", "utf-8");

    // Act
    cli(["node", flowToTsPath, "--log-level", "info", "--progress", inputPath]);

    // Assert
    expect(interrupt).toHaveBeenCalledWith(
      `${colors.green(inputPath)}\nconst a: number = 5;\n`
    );
  });

  it("should output transpiled code via process.stdout if logLevel disallows it", () => {
    // Arrange
    const inputPath = path.join(tmpdir, "test.js");
    fs.writeFileSync(inputPath, "const a: number = 5;", "utf-8");

    // Act
    cli(["node", flowToTsPath, inputPath]);

    // Assert
    expect(process.stdout.write).toHaveBeenCalledWith(
      `${colors.green(inputPath)}\nconst a: number = 5;\n`
    );
  });

  it("should not write a file", () => {
    // Arrange
    const inputPath = path.join(tmpdir, "test.js");
    fs.writeFileSync(inputPath, "const a: number = 5;", "utf-8");

    // Act
    cli(["node", flowToTsPath, inputPath]);

    // Assert
    const outputPath = path.join(tmpdir, "test.ts");
    expect(fs.existsSync(outputPath)).toBe(false);
  });

  it("should log any files with errors", () => {
    // Arrange
    const inputPath = path.join(tmpdir, "test.js");
    fs.writeFileSync(inputPath, "?", "utf-8");

    // Act
    cli(["node", flowToTsPath, "--progress", inputPath]);

    // Assert
    expect(interrupt).toHaveBeenCalledWith(
      colors.red(
        `Error processing ${colors.green(
          inputPath
        )}\nSyntaxError: Unexpected token (1:0)\n`
      )
    );
  });

  it("should write a file", () => {
    // Arrange
    const inputPath = path.join(tmpdir, "test.js");
    fs.writeFileSync(inputPath, "const a: number = 5;", "utf-8");

    // Act
    cli(["node", flowToTsPath, "--write", inputPath]);

    // Assert
    expect(fs.existsSync(path.join(tmpdir, "test.ts"))).toBe(true);
  });

  it("should write all files in a directory", () => {
    // Arrange
    fs.writeFileSync(
      path.join(tmpdir, "foo.js"),
      "const a: number = 5;",
      "utf-8"
    );
    fs.writeFileSync(
      path.join(tmpdir, "bar.js"),
      "const b: boolean = true;",
      "utf-8"
    );

    // Act
    cli(["node", flowToTsPath, "--write", tmpdir]);

    // Assert
    expect(fs.existsSync(path.join(tmpdir, "foo.ts"))).toBe(true);
    expect(fs.existsSync(path.join(tmpdir, "bar.ts"))).toBe(true);
  });

  it("should delete the original file", () => {
    // Arrange
    const inputPath = path.join(tmpdir, "test.js");
    const outputPath = path.join(tmpdir, "test.ts");
    fs.writeFileSync(inputPath, "const a: number = 5;", "utf-8");

    // Act
    cli(["node", flowToTsPath, "--write", "--delete-source", inputPath]);

    // Assert
    expect(fs.existsSync(outputPath)).toBe(true);
    expect(fs.existsSync(inputPath)).toBe(false);
  });

  it("should delete many original files in a directory", () => {
    // Arrange
    fs.writeFileSync(
      path.join(tmpdir, "foo.js"),
      "const a: number = 5;",
      "utf-8"
    );
    fs.writeFileSync(
      path.join(tmpdir, "bar.js"),
      "const b: boolean = true;",
      "utf-8"
    );

    // Act
    cli(["node", flowToTsPath, "--write", "--delete-source", tmpdir]);

    // Assert
    expect(fs.existsSync(path.join(tmpdir, "foo.ts"))).toBe(true);
    expect(fs.existsSync(path.join(tmpdir, "bar.ts"))).toBe(true);
    expect(fs.existsSync(path.join(tmpdir, "foo.js"))).toBe(false);
    expect(fs.existsSync(path.join(tmpdir, "bar.js"))).toBe(false);
  });

  it("should write to the file", () => {
    // Arrange
    const inputPath = path.join(tmpdir, "test.js");
    const outputPath = path.join(tmpdir, "test.ts");
    fs.writeFileSync(inputPath, "const a: number = 5;", "utf-8");

    // Act
    cli(["node", flowToTsPath, "--write", inputPath]);

    // Assert
    const output = fs.readFileSync(outputPath, "utf-8");
    expect(output).toBe("const a: number = 5;");
  });

  it("should support prettier without a config file", () => {
    // Arrange
    const prettierFixturesPath = path.join(fixturesPath, "prettier");
    const outputPath = path.join(tmpdir, "base.tsx");
    const outputExpectedPath = path.join(
      prettierFixturesPath,
      "typescript-without-config.tsx"
    );
    const inputPath = path.join(prettierFixturesPath, "base.js");

    // Act
    cli([
      "node",
      flowToTsPath,
      "--prettier",
      "--write",
      "--write-path",
      tmpdir,
      inputPath
    ]);

    // Assert
    const output = fs.readFileSync(outputPath, "utf-8");
    const outputExpected = fs.readFileSync(outputExpectedPath, "utf-8");
    expect(output).toBe(outputExpected);
  });

  it("should support prettier with a config file", () => {
    // Arrange
    const prettierFixturesPath = path.join(fixturesPath, "prettier");
    const prettierConfigPath = path.join(prettierFixturesPath, "prettierrc");
    const outputPath = path.join(tmpdir, "base.tsx");
    const outputExpectedPath = path.join(
      prettierFixturesPath,
      "typescript-with-config.tsx"
    );
    const inputPath = path.join(prettierFixturesPath, "base.js");

    // Act
    cli([
      "node",
      flowToTsPath,
      "--prettier",
      prettierConfigPath,
      "--write",
      "--write-path",
      tmpdir,
      inputPath
    ]);

    // Assert
    const output = fs.readFileSync(outputPath, "utf-8");
    const outputExpected = fs.readFileSync(outputExpectedPath, "utf-8");
    expect(output).toBe(outputExpected);
  });

  it("should match the regular expression defined by --input-pattern option", () => {
    // Arrange
    const inputPatternFixturesPath = path.join(fixturesPath, "input-pattern");

    // Act
    cli([
      "node",
      flowToTsPath,
      "--input-pattern",
      "^EXACTMATCH$",
      "--write",
      "--write-path",
      tmpdir,
      inputPatternFixturesPath
    ]);

    // Assert
    const writtenFiles = fsReadDirRecursive(tmpdir);
    expect(writtenFiles).toHaveLength(1);
    expect(writtenFiles[0]).toEqual("EXACTMATCH");
  });

  it("outputs a .ts file if no JSX is present", () => {
    // Arrange
    const detectsJSXFixturesPath = path.join(fixturesPath, "detects-jsx");

    // Act
    cli([
      "node",
      flowToTsPath,
      "--write",
      "--write-path",
      tmpdir,
      path.join(detectsJSXFixturesPath, "has-no-jsx.js")
    ]);

    // Assert
    const writtenFiles = fsReadDirRecursive(tmpdir);
    expect(writtenFiles).toHaveLength(1);
    expect(writtenFiles[0]).toEqual("has-no-jsx.ts");
  });

  it("outputs a .tsx file if JSX is present", () => {
    // Arrange
    const detectsJSXFixturesPath = path.join(fixturesPath, "detects-jsx");

    // Act
    cli([
      "node",
      flowToTsPath,
      "--write",
      "--write-path",
      tmpdir,
      path.join(detectsJSXFixturesPath, "has-jsx.js")
    ]);

    // Assert
    const writtenFiles = fsReadDirRecursive(tmpdir);
    expect(writtenFiles).toHaveLength(1);
    expect(writtenFiles[0]).toEqual("has-jsx.tsx");
  });

  it("should tick ProgressBar twice per file", () => {
    // Arrange
    const inputPath = path.join(tmpdir, "test.js");
    fs.writeFileSync(inputPath, "const a: number = 5;", "utf-8");

    // Act
    cli(["node", flowToTsPath, "--log-level", "info", "--progress", inputPath]);

    // Assert
    expect(tick).toHaveBeenNthCalledWith(1, 0, { file: inputPath });
    expect(tick).toHaveBeenNthCalledWith(2);
  });

  // TODO: add tests for option handling
});
