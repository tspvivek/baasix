// Import from the installed package
import { APIError } from "@tspvivek/baasix-drizzle";

const registerEndpoint = (app, context) => {
  app.get("/user-info", async (req, res, next) => {
    try {
      // Check if user is authenticated
      if (!req.accountability || !req.accountability.user) {
        throw new APIError("Unauthorized", 401);
      }

      const { user, role } = req.accountability;

      const userDetails = {
        id: user.id,
        email: user.email,
        firstName: user.firstName,
      };

      const roleDetails = {
        id: role.id,
        name: role.name,
      };

      res.json({
        user: userDetails,
        role: roleDetails,
      });
    } catch (error) {
      next(error);
    }
  });
};

export default {
  id: "user-info",
  handler: registerEndpoint,
};
