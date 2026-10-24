// Apply a saved theme before React and its stylesheet load to avoid a light flash.
(() => {
  try {
    const savedTheme = window.localStorage.getItem('pizza-house-theme');
    if (savedTheme === 'dark') {
      document.documentElement.dataset.theme = 'dark';
      document.documentElement.style.colorScheme = 'dark';
      const themeColor = document.querySelector('meta[name="theme-color"]');
      if (themeColor) themeColor.content = '#07131e';
    }
  } catch {
    // Private browsing/storage restrictions fall back to the light theme.
  }
})();
