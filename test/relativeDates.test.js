import { resolveDynamicVariables } from "../baasix/utils/dynamicVariableResolver.js";
import { test, expect, describe } from "@jest/globals";

describe("Relative Date Dynamic Variables", () => {
    const mockAccountability = {
        user: { id: "test-user-id" },
        role: { id: "test-role-id" }
    };

    test("should resolve basic $NOW", async () => {
        const input = { createdAt: "$NOW" };
        const result = await resolveDynamicVariables(input, mockAccountability);

        expect(result.createdAt).toMatch(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/);
        expect(new Date(result.createdAt)).toBeInstanceOf(Date);
    });

    test("should resolve $NOW+DAYS_7", async () => {
        const input = { futureDate: "$NOW+DAYS_7" };
        const result = await resolveDynamicVariables(input, mockAccountability);

        const now = new Date();
        const resolved = new Date(result.futureDate);
        const expectedTime = now.getTime() + (7 * 24 * 60 * 60 * 1000);

        // Allow for small time differences (test execution time)
        expect(Math.abs(resolved.getTime() - expectedTime)).toBeLessThan(1000);
    });

    test("should resolve $NOW-DAYS_7", async () => {
        const input = { pastDate: "$NOW-DAYS_7" };
        const result = await resolveDynamicVariables(input, mockAccountability);

        const now = new Date();
        const resolved = new Date(result.pastDate);
        const expectedTime = now.getTime() - (7 * 24 * 60 * 60 * 1000);

        expect(Math.abs(resolved.getTime() - expectedTime)).toBeLessThan(1000);
    });

    test("should resolve $NOW+HOURS_2", async () => {
        const input = { twoHoursLater: "$NOW+HOURS_2" };
        const result = await resolveDynamicVariables(input, mockAccountability);

        const now = new Date();
        const resolved = new Date(result.twoHoursLater);
        const expectedTime = now.getTime() + (2 * 60 * 60 * 1000);

        expect(Math.abs(resolved.getTime() - expectedTime)).toBeLessThan(1000);
    });

    test("should resolve $NOW-MINUTES_30", async () => {
        const input = { thirtyMinutesAgo: "$NOW-MINUTES_30" };
        const result = await resolveDynamicVariables(input, mockAccountability);

        const now = new Date();
        const resolved = new Date(result.thirtyMinutesAgo);
        const expectedTime = now.getTime() - (30 * 60 * 1000);

        expect(Math.abs(resolved.getTime() - expectedTime)).toBeLessThan(1000);
    });

    test("should resolve $NOW+SECONDS_30", async () => {
        const input = { thirtySecondsLater: "$NOW+SECONDS_30" };
        const result = await resolveDynamicVariables(input, mockAccountability);

        const now = new Date();
        const resolved = new Date(result.thirtySecondsLater);
        const expectedTime = now.getTime() + (30 * 1000);

        expect(Math.abs(resolved.getTime() - expectedTime)).toBeLessThan(1000);
    });

    test("should resolve $NOW+WEEKS_2", async () => {
        const input = { twoWeeksLater: "$NOW+WEEKS_2" };
        const result = await resolveDynamicVariables(input, mockAccountability);

        const now = new Date();
        const resolved = new Date(result.twoWeeksLater);
        const expectedTime = now.getTime() + (2 * 7 * 24 * 60 * 60 * 1000);

        expect(Math.abs(resolved.getTime() - expectedTime)).toBeLessThan(1000);
    });

    test("should resolve $NOW+MONTHS_1", async () => {
        const input = { oneMonthLater: "$NOW+MONTHS_1" };
        const result = await resolveDynamicVariables(input, mockAccountability);

        const now = new Date();
        const resolved = new Date(result.oneMonthLater);
        const expectedTime = now.getTime() + (30 * 24 * 60 * 60 * 1000); // 30 days approximation

        expect(Math.abs(resolved.getTime() - expectedTime)).toBeLessThan(1000);
    });

    test("should resolve $NOW+YEARS_1", async () => {
        const input = { oneYearLater: "$NOW+YEARS_1" };
        const result = await resolveDynamicVariables(input, mockAccountability);

        const now = new Date();
        const resolved = new Date(result.oneYearLater);
        const expectedTime = now.getTime() + (365 * 24 * 60 * 60 * 1000);

        expect(Math.abs(resolved.getTime() - expectedTime)).toBeLessThan(1000);
    });

    test("should handle singular forms (DAY, HOUR, etc.)", async () => {
        const input = {
            tomorrow: "$NOW+DAY_1",
            hourAgo: "$NOW-HOUR_1"
        };
        const result = await resolveDynamicVariables(input, mockAccountability);

        const now = new Date();
        const tomorrow = new Date(result.tomorrow);
        const hourAgo = new Date(result.hourAgo);

        expect(Math.abs(tomorrow.getTime() - (now.getTime() + 24 * 60 * 60 * 1000))).toBeLessThan(1000);
        expect(Math.abs(hourAgo.getTime() - (now.getTime() - 60 * 60 * 1000))).toBeLessThan(1000);
    });

    test("should work in complex filter objects", async () => {
        const input = {
            filter: {
                "AND": [
                    { "createdAt": { "gte": "$NOW-DAYS_30" } },
                    { "updatedAt": { "lte": "$NOW+HOURS_1" } }
                ]
            }
        };

        const result = await resolveDynamicVariables(input, mockAccountability);

        expect(result.filter.AND[0]["createdAt"].gte).toMatch(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/);
        expect(result.filter.AND[1]["updatedAt"].lte).toMatch(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/);
    });

    test("should work in array contexts", async () => {
        const input = {
            dates: ["$NOW-DAYS_1", "$NOW", "$NOW+DAYS_1"]
        };

        const result = await resolveDynamicVariables(input, mockAccountability);

        expect(result.dates).toHaveLength(3);
        result.dates.forEach(date => {
            expect(date).toMatch(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/);
        });

        // Verify they are in chronological order
        const dates = result.dates.map(d => new Date(d));
        expect(dates[0].getTime()).toBeLessThan(dates[1].getTime());
        expect(dates[1].getTime()).toBeLessThan(dates[2].getTime());
    });

    test("should handle invalid patterns gracefully", async () => {
        const input = {
            invalid1: "$NOW+INVALID_5",
            invalid2: "$NOW-",
            invalid3: "$NOWWRONG"
        };

        const result = await resolveDynamicVariables(input, mockAccountability);

        // Invalid patterns should remain unchanged
        expect(result.invalid1).toBe("$NOW+INVALID_5");
        expect(result.invalid2).toBe("$NOW-");
        expect(result.invalid3).toBe("$NOWWRONG");
    });

    test("should work with large numbers", async () => {
        const input = { farFuture: "$NOW+DAYS_365" };
        const result = await resolveDynamicVariables(input, mockAccountability);

        const now = new Date();
        const resolved = new Date(result.farFuture);
        const expectedTime = now.getTime() + (365 * 24 * 60 * 60 * 1000);

        expect(Math.abs(resolved.getTime() - expectedTime)).toBeLessThan(1000);
    });
});