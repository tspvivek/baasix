export default (hooksService, context) => {
  // Get ItemsService from context (provided by the app)
  const { ItemsService } = context;

  // Hook for creating a post
  hooksService.registerHook(
    "posts2",
    "items.create",
    async ({ data, accountability, collection, schema }) => {
      console.log("Creating post:", data);
      // Add created_by field
      data.created_by = accountability.user.id;
      // Add created_at timestamp
      data.created_at = new Date();
      return { data };
    }
  );

  // Hook for reading posts
  hooksService.registerHook(
    "posts2",
    "items.read",
    async ({ query, data, accountability, collection, schema }) => {
      console.log("Reading posts with query:", query);
      // Add a condition to only return published posts for non-admin users
      if (accountability.role.name !== "administrator") {
        query.filter = {
          ...JSON.parse(query.filter || "{}"),
          published: true,
        };
      }
      return { query };
    }
  );

  // Hook for updating a post
  hooksService.registerHook("posts2", "items.update", async ({ id, data, accountability, schema }) => {
    console.log("Updating post:", data);
    // Add updated_by field
    data.updated_by = accountability.user.id;
    // Add updated_at timestamp
    data.updated_at = new Date();
    return { id, data };
  });

  // Hook for deleting a post
  hooksService.registerHook("posts2", "items.delete", async ({ id, accountability }) => {
    console.log("Deleting post:", id);
    // Instead of deleting, we'll mark the post as archived
    let postsService = new ItemsService("posts2", {
      accountability: accountability,
    });

    // DON'T pass transaction - we want this update to commit immediately
    // This way the archive happens even when we throw an error to prevent deletion
    await postsService.updateOne(id, {
      archived: true,
      archived_by: accountability.user.id,
      archived_at: new Date(),
    }, { bypassPermissions: true });

    // Prevent the actual deletion by throwing error
    // The archive update above is already committed, so it won't be rolled back
    throw new Error("Post archived instead of deleted");
  });
};
