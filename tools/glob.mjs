export const globToRegExp = (pattern) => {
    const escaped = pattern
        .replace(/[.+^${}()|[\]\\]/g, "\\$&")
        .replace(/\*\*/g, "::DOUBLESTAR::")
        .replace(/\*/g, "[^/]*")
        .replace(/::DOUBLESTAR::/g, ".*");

    return new RegExp(`^${escaped}$`);
};

export const matchesAnyGlob = (relativePath, patterns) =>
    patterns.some((pattern) => globToRegExp(pattern).test(relativePath));
