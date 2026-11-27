/**
 * A phone is a viewport 700px wide or less. The class on `body` switches layout and
 * gestures; geometry, commands and the file format stay as they are.
 */
export const PHONE_MAX_WIDTH = 700;
export const PHONE_QUERY = `(max-width: ${PHONE_MAX_WIDTH}px)`;

export function isPhone(): boolean {
  return typeof document !== 'undefined' && document.body.classList.contains('al-phone');
}

/** Keeps `body.al-phone` in step with the viewport. */
export function watchPhone(onChange: (phone: boolean) => void): () => void {
  const mq = window.matchMedia(PHONE_QUERY);
  const fire = () => {
    const phone = mq.matches;
    document.body.classList.toggle('al-phone', phone);
    onChange(phone);
  };
  fire();
  mq.addEventListener('change', fire);
  return () => mq.removeEventListener('change', fire);
}
