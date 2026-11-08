export function isDesktopDevice(
  userAgent = navigator.userAgent,
  touchPoints = navigator.maxTouchPoints,
) {
  const mobile = /Android|iPhone|iPad|iPod/i.test(userAgent);
  // iPadOS can identify itself as desktop Safari.
  const ipad = /Macintosh/i.test(userAgent) && touchPoints > 1;
  return !mobile && !ipad;
}
