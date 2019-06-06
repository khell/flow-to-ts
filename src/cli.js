const commander = require("commander");
const fs = require("fs");
const fsReadDirRecursive = require("fs-readdir-recursive");
const glob = require("glob");
const path = require("path");

const convert = require("./convert.js");
const version = require("../package.json").version;

const cli = argv => {
  const program = new commander.Command();

  program
    .version(version)
    .option("--inline-utility-types", "inline utility types when possible")
    .option(
      "--prettier [config]",
      "use prettier for formatting with optional path to config file"
    )
    .option(
      "--semi",
      "add semi-colons, defaults to 'false' (depends on --prettier)"
    )
    .option(
      "--single-quote",
      "use single quotes instead of double quotes, defaults to 'false' (depends on --prettier)"
    )
    .option(
      "--tab-width [width]",
      "size of tabs (depends on --prettier)",
      /2|4/,
      4
    )
    .option(
      "--trailing-comma [all|es5|none]",
      "where to put trailing commas (depends on --prettier)",
      /all|es5|none/,
      "all"
    )
    .option(
      "--bracket-spacing",
      "put spaces between braces and contents (depends on --prettier)"
    )
    .option(
      "--arrow-parens [avoid|always]",
      "arrow function param list parens (depends on --prettier)",
      /avoid|always/,
      "avoid"
    )
    .option("--print-width [width]", "line width (depends on --prettier)", 80)
    .option("--write", "write output to disk instead of STDOUT")
    .option(
      "--write-path [path]",
      "optional path to write to (depends on --write)"
    )
    .option("--delete-source", "delete the source file")
    .option(
      "--extension [.ts|.tsx]",
      "output file extension (default: .ts)",
      /\.ts(x)/,
      ".ts"
    );

  program.parse(argv);

  // Check write directory validity
  let isValidWriteDirectory = true;
  try {
    if (typeof program.write === "string") {
      const stat = fs.statSync(program.write);
      isValidWriteDirectory = stat.isDirectory();
    }
  } catch (error) {
    isValidWriteDirectory = false;
  }

  const fileOrDir = program.args[program.args.length - 1];
  if (
    program.args.length === 0 ||
    !fs.existsSync(fileOrDir) ||
    !isValidWriteDirectory
  ) {
    program.outputHelp();
    process.exit(1);
    return;
  }

  const options = {
    inlineUtilityTypes: Boolean(program.inlineUtilityTypes),
    prettier: program.prettier,
    semi: Boolean(program.semi),
    singleQuote: Boolean(program.singleQuote),
    tabWidth: parseInt(program.tabWidth),
    trailingComma: program.trailingComma,
    bracketSpacing: Boolean(program.bracketSpacing),
    arrowParens: program.arrowParens,
    printWidth: program.printWidth,
    extension: program.extension
  };

  let files = [fileOrDir];
  const stat = fs.statSync(fileOrDir);
  if (stat.isDirectory()) {
    files = fsReadDirRecursive(fileOrDir)
      .filter(f => path.extname(f) === ".js")
      .map(f => path.join(fileOrDir, f));
  }

  for (const file of files) {
    console.log(`[TRANSPILING] ${file}`);

    const inFile = file;
    const inCode = fs.readFileSync(inFile, "utf-8");

    try {
      const outCode = convert(inCode, options);

      if (program.write) {
        const outPath =
          typeof program.writePath === "string"
            ? program.writePath
            : path.dirname(file);
        const outFile = path
          .basename(file)
          .replace(/\.js$/, program.extension || ".ts");
        fs.writeFileSync(path.join(outPath, outFile), outCode);
      } else {
        console.log(outCode);
      }

      if (program.deleteSource) {
        fs.unlinkSync(inFile);
      }
    } catch (e) {
      console.log(`===> error processing ${inFile}`);
      console.log(e);
    }
  }
};

module.exports = cli;
