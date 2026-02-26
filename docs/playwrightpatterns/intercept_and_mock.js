// Mock API responses
test("displays error when API fails", async ({ page }) => {
  await page.route("**/api/users", (route) => {
    route.fulfill({
      status: 500,
      contentType: "application/json",
      body: JSON.stringify({ error: "Internal Server Error" }),
    });
  });

  await page.goto("/users");
  await expect(page.getByText("Failed to load users")).toBeVisible();
});

// Intercept and modify requests
test("can modify API request", async ({ page }) => {
  await page.route("**/api/users", async (route) => {
    const request = route.request();
    const postData = JSON.parse(request.postData() || "{}");

    // Modify request
    postData.role = "admin";

    await route.continue({
      postData: JSON.stringify(postData),
    });
  });

  // Test continues...
});

// Mock third-party services
test("payment flow with mocked Stripe", async ({ page }) => {
  await page.route("**/api/stripe/**", (route) => {
    route.fulfill({
      status: 200,
      body: JSON.stringify({
        id: "mock_payment_id",
        status: "succeeded",
      }),
    });
  });

  // Test payment flow with mocked response
});