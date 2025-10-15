function readPackage(pkg) {
  const allowedPackages = ['@nestjs/core', '@tailwindcss/oxide', 'sharp', 'unrs-resolver'];
  if (allowedPackages.includes(pkg.name)) {
    pkg.requiresBuild = true;
  }
  return pkg;
}

module.exports = {
  hooks: {
    readPackage
  }
};