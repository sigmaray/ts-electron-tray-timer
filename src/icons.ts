import { nativeImage, type NativeImage } from "electron";
import { createCanvas } from "canvas";

/** Draw a compact tray icon with a centered label.
 * @param text Short label to render in the icon.
 * @param isBlinking Whether to use the alert red background.
 */
export function createTextIcon(text: string, isBlinking = false): NativeImage {
  const size = 22;
  const canvas = createCanvas(size, size);
  const context = canvas.getContext("2d");
  context.fillStyle = isBlinking ? "#ff0000" : "#7c3aed";
  context.fillRect(0, 0, size, size);
  context.fillStyle = "#ffffff";
  context.font = "bold 12px Arial";
  context.textAlign = "center";
  context.textBaseline = "middle";
  context.fillText(text, size / 2, size / 2);
  return nativeImage.createFromBuffer(canvas.toBuffer("image/png"));
}

/** Format remaining seconds for the tray icon label.
 * @param seconds Number of seconds remaining.
 */
export function formatTimeForTray(seconds: number): string {
  if (seconds <= 0) return "—";
  if (seconds < 60) return `${seconds}s`;

  const minutes = Math.floor(seconds / 60);
  if (minutes < 60) return `${minutes}m`;
  return `${(seconds / 3600).toFixed(1)}h`;
}

/** Format remaining seconds as a detailed tray tooltip.
 * @param seconds Number of seconds remaining.
 */
export function formatTimeForTooltip(seconds: number): string {
  if (seconds <= 0) return "0s";

  const hours = Math.floor(seconds / 3600);
  const minutes = Math.floor((seconds % 3600) / 60);
  const remainingSeconds = seconds % 60;
  const parts: string[] = [];
  if (hours > 0) parts.push(`${hours}h`);
  if (minutes > 0) parts.push(`${minutes}m`);
  if (remainingSeconds > 0 || parts.length === 0)
    parts.push(`${remainingSeconds}s`);
  return parts.join(" ");
}

/** Draw the application's clock icon. */
export function createAppIcon(): NativeImage {
  const size = 256;
  const canvas = createCanvas(size, size);
  const context = canvas.getContext("2d");
  const gradient = context.createLinearGradient(0, 0, size, size);
  gradient.addColorStop(0, "#667eea");
  gradient.addColorStop(1, "#764ba2");

  const radius = size * 0.15;
  context.fillStyle = gradient;
  context.beginPath();
  context.moveTo(radius, 0);
  context.lineTo(size - radius, 0);
  context.quadraticCurveTo(size, 0, size, radius);
  context.lineTo(size, size - radius);
  context.quadraticCurveTo(size, size, size - radius, size);
  context.lineTo(radius, size);
  context.quadraticCurveTo(0, size, 0, size - radius);
  context.lineTo(0, radius);
  context.quadraticCurveTo(0, 0, radius, 0);
  context.closePath();
  context.fill();

  context.strokeStyle = "#ffffff";
  context.fillStyle = "#ffffff";
  context.lineWidth = size * 0.03;
  const centerX = size / 2;
  const centerY = size / 2;
  const clockRadius = size * 0.3;
  context.beginPath();
  context.arc(centerX, centerY, clockRadius, 0, 2 * Math.PI);
  context.stroke();
  context.beginPath();
  context.moveTo(centerX, centerY);
  context.lineTo(centerX, centerY - clockRadius * 0.5);
  context.lineWidth = size * 0.04;
  context.stroke();
  context.beginPath();
  context.moveTo(centerX, centerY);
  context.lineTo(centerX, centerY - clockRadius * 0.7);
  context.lineWidth = size * 0.025;
  context.stroke();
  context.beginPath();
  context.arc(centerX, centerY, size * 0.02, 0, 2 * Math.PI);
  context.fill();

  return nativeImage.createFromBuffer(canvas.toBuffer("image/png"));
}
