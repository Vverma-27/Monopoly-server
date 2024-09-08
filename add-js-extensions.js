import fs from "fs";
import path from "path";

function addJsExtension(directory) {
  const files = fs.readdirSync(directory);

  files.forEach((file) => {
    const filePath = path.join(directory, file);
    const stats = fs.statSync(filePath);

    if (stats.isDirectory()) {
      addJsExtension(filePath);
    } else if (file.endsWith(".js")) {
      let content = fs.readFileSync(filePath, "utf8");

      // Regular expression to match import statements without file extensions
      const importRegex = /from\s+['"](.+?)['"]/g;

      content = content.replace(importRegex, (match, p1) => {
        // Don't add .js if it's a package import or already has an extension
        if (!p1.startsWith(".") || path.extname(p1)) {
          return match;
        }
        return `from '${p1}.js'`;
      });

      fs.writeFileSync(filePath, content);
    }
  });
}

// Usage: node add-js-extension.js <directory>
const directory = process.argv[2] || "./dist";
addJsExtension(directory);

console.log("Added .js extensions to imports in", directory);
