export default {
    preset: 'ts-jest/presets/default-esm',
    testEnvironment: "node",
    extensionsToTreatAsEsm: ['.ts'],
    testMatch: ["**/test/**/*.test.js"],
    testPathIgnorePatterns: ["/node_modules/", "/dist/"],
    coveragePathIgnorePatterns: ["/node_modules/"],
    transformIgnorePatterns: [
        // Transform better-auth and better-call ESM modules
        'node_modules/(?!(better-auth|better-call))',
    ],
    setupFilesAfterEnv: ["<rootDir>/test/setup.js"],
    testSequencer: "<rootDir>/test/testSequencer.js",
    reporters: [
        "default",
        [
            "jest-html-reporter",
            {
                outputPath: "./test-report.html",
                pageTitle: "Test Report",
            },
        ],
    ],
    transform: {
        '^.+\\.(js|ts|mjs)$': ['ts-jest', {
            useESM: true,
            isolatedModules: true,
            tsconfig: {
                module: 'es2022',
                target: 'es2022',
                allowJs: true,
                strict: false,
            }
        }],
    },
    moduleNameMapper: {
        '^(\\.{1,2}/.*)\\.js$': '$1',
    },
    testTimeout: 360 * 1000,
};
