const AUTH_FLASH_KEY = 'wenflow-auth-flash';

export const setAuthFlashMessage = (message: string) => {
  try {
    sessionStorage.setItem(AUTH_FLASH_KEY, message);
  } catch {
    // 存储不可用时仍继续跳转登录页。
  }
};

export const consumeAuthFlashMessage = () => {
  try {
    const message = sessionStorage.getItem(AUTH_FLASH_KEY);
    sessionStorage.removeItem(AUTH_FLASH_KEY);
    return message;
  } catch {
    return null;
  }
};
