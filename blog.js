// Function to fetch and parse markdown posts
async function fetchPosts() {
  try {
    const response = await fetch("posts/posts.json");
    const posts = await response.json();
    return posts;
  } catch (error) {
    console.error("Error loading posts:", error);
    return [];
  }
}

// Function to create blog post HTML
function createBlogPostElement(post) {
  return `
        <article class="blog-post">
            ${post.image ? `<img src="${post.image}" alt="${post.title}">` : ""}
            <div class="blog-post-content">
                <h2>${post.title}</h2>
                <div class="metadata">
                    <span class="date">${post.date}</span>
                    ${
                      post.tags
                        ? `<span class="tags">${post.tags.join(", ")}</span>`
                        : ""
                    }
                </div>
                <p>${post.excerpt}</p>
                <a href="post.html?id=${
                  post.id
                }" class="read-more">Read More</a>
            </div>
        </article>
    `;
}

// Function to render blog posts
async function renderBlogPosts() {
  const blogSection = document.querySelector(".blog-posts");
  const posts = await fetchPosts();
  const postsHTML = posts
    .sort((a, b) => new Date(b.date) - new Date(a.date))
    .map((post) => createBlogPostElement(post))
    .join("");
  blogSection.innerHTML = postsHTML;
}

// Initialize the blog when the page loads
document.addEventListener("DOMContentLoaded", () => {
  renderBlogPosts();
});
