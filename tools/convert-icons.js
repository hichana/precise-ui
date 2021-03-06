const svgToReact = require('svg-react-loader/lib');
const prettier = require('prettier');
const fs = require('fs');
const path = require('path');

function getConfig(dir) {
  try {
    return require(path.resolve(dir, 'icongen.config.js'));
  } catch (e) {
    return undefined;
  }
}

const cwd = process.cwd();
const src = path.resolve(cwd, process.argv[2] || '');
const dest = path.resolve(cwd, process.argv[3] || '');
const prettierConfig = path.resolve(__dirname, '../prettier.config.js');
const icongenConfig = getConfig(cwd) || getConfig(__dirname) || {};
const rootDir = icongenConfig && icongenConfig.rootDir ? path.join(cwd, icongenConfig.rootDir) : '';
const search = (icongenConfig && icongenConfig.search) || [];
const testRx = new RegExp(`${(icongenConfig && icongenConfig.testRegex) || ''}`, 'ig');
const renameRx = new RegExp(`${(icongenConfig && icongenConfig.cleanNameRegex) || ''}`, 'ig');
const iconDirectories = (icongenConfig && icongenConfig.iconDirectories) || src;
const outDir = (icongenConfig && icongenConfig.outDir) || dest;

const svgIconPropsInterface = `export interface SvgIconProps {
  width?: string | null;
  height?: string | null;
  viewBox?: string;
  version?: string;
  style?: React.CSSProperties;
}`;

const svgIconConstructorInterface = `export interface SvgIconConstructor {
  (props: SvgIconProps): React.ReactSVGElement;
  displayName: string;
  defaultProps: {
    version?: string;
    width: string;
    height: string;
    viewBox: string;
  };
}`;

if (!fs.existsSync(src)) {
  console.log('The given source directory does not exist.');
  return process.abort();
}

if (!fs.existsSync(outDir)) {
  console.log('The given target directory does not exist.');
  return process.abort();
}

function titleCase(str) {
  const name = path.parse(str).name;
  return name
    .split('_')
    .map(p => `${p[0].toUpperCase()}${p.substr(1)}`)
    .join('');
}

function generate(icon) {
  const opts = {
    displayName: titleCase(icon.name),
    classIdPrefix: false,
    propsMap: {},
    filters: [],
  };

  return new Promise((resolve, reject) => {
    svgToReact(opts, icon.content).subscribe(resolve, reject);
  });
}

function cleanName(content) {
  return path.basename(content).replace(renameRx, () => '');
}

function tests(content) {
  const matcher = /export const ([A-Za-z0-9]+) =/g;
  const items = [];
  let result = matcher.exec(content);

  while (result) {
    items.push(result[1]);
    result = matcher.exec(content);
  }

  return `// AUTO GENERATED by /tools/convert-icons.js
// COMING FROM material-design-icons
// (c) Material UI
// Licensed under MIT
// https://github.com/mui-org/material-ui
import * as React from 'react';
import * as enzyme from 'enzyme';
import * as icons from './icons';

describe('Generated icons', () => {${items
    .map(
      item => `
  it('should render ${item} icon', () => {
    const Component = icons.${item};
    const wrapper = enzyme.mount(<Component width="12" height="12" />);
    expect(wrapper).toMatchSnapshot();
  });`,
    )
    .join('\n')}
});
  `;
}

function transform(source) {
  const lines = source.split('\n');
  const name = /function ([A-Za-z0-9]+) \(props\)/.exec(lines[2])[1];
  lines[2] = `export const ${name} = <SvgIconConstructor>function(props: SvgIconProps) {`;
  lines.splice(lines.length - 6, 0, `${name}.displayName = '${name}';`);
  return lines.filter((_, line) => line > 1 && line < lines.length - 4).join('\n');
}

function output(content) {
  const moduleTarget = path.join(outDir, 'icons.ts');
  const testTarget = path.join(outDir, 'icons.test.tsx');
  const unitTests = tests(content);
  fs.writeFileSync(moduleTarget, content, 'utf8');
  fs.writeFileSync(testTarget, unitTests, 'utf8');
}

function readDirectoriesSync(_directories) {
  const directories = Array.isArray(_directories) ? _directories : [_directories];
  let results = [];
  directories.forEach(dir => {
    if (fs.lstatSync(dir).isDirectory()) {
      const list = fs.readdirSync(dir);
      list.forEach(file => {
        filePath = path.join(dir, file);
        const stat = fs.statSync(filePath);
        if (stat && stat.isDirectory()) {
          results = results.concat(readDirectoriesSync(filePath));
        } else {
          results.push(filePath);
        }
      });
    }
  });
  return results;
}

const searchedIcons = readDirectoriesSync(rootDir).filter(
  file => file.search(testRx) > -1 && search.indexOf(path.basename(file)) > -1,
);
const iconFiles = readDirectoriesSync(iconDirectories).concat(searchedIcons);

const icons = iconFiles.filter(fn => fn.endsWith('.svg')).map(fn => ({
  name: titleCase(cleanName(fn)),
  content: fs.readFileSync(fn, 'utf8'),
}));

const promises = icons.map(icon => generate(icon).then(transform));

prettier
  .resolveConfig(prettierConfig)
  .then(options => {
    return Promise.all(promises)
      .then(components =>
        [
          '// AUTO GENERATED by /tools/convert-icons.js',
          '// add new icons to /tools/icongen.config.js',
          '',
          `import * as React from 'react';`,
          '',
          svgIconPropsInterface,
          '',
          svgIconConstructorInterface,
          '',
          ...components,
        ].join('\n'),
      )
      .then(code => prettier.format(code, options));
  })
  .then(output);
