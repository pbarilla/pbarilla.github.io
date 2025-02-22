async function loadPost() {
  const urlParams = new URLSearchParams(window.location.search);
  const postId = urlParams.get("id");

  if (!postId) {
    window.location.href = "index.html";
    return;
  }

  try {
    // First load the post metadata
    const response = await fetch("posts/posts.json");
    const posts = await response.json();
    const post = posts.find((p) => p.id === postId);

    if (!post) {
      throw new Error("Post not found");
    }

    // Then load the actual markdown content
    const markdownResponse = await fetch(`posts/${postId}.md`);
    const markdownContent = await markdownResponse.text();

    // Render the post
    const postContainer = document.getElementById("post-content");
    postContainer.innerHTML = `
            <div class="post-header">
                <h1 class="post-title">${post.title}</h1>
                <div class="post-metadata">
                    <span class="post-date">${post.date}</span>
                </div>
                ${
                  post.tags
                    ? `
                    <div class="post-tags">
                        ${post.tags
                          .map((tag) => `<span class="post-tag">${tag}</span>`)
                          .join("")}
                    </div>
                `
                    : ""
                }
            </div>
            <div class="post-content">
                ${marked.parse(markdownContent)}
            </div>
        `;

    document.title = `${post.title} - My Blog`;
  } catch (error) {
    console.error("Error loading post:", error);
    document.getElementById("post-content").innerHTML = `
            <h1>Post Not Found</h1>
            <p>Sorry, the requested post could not be found.</p>
            <a href="index.html">Return to Home</a>
        `;
  }
}

document.addEventListener("DOMContentLoaded", loadPost);
