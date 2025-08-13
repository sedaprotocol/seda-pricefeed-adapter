import { createInterface } from "node:readline";

export async function confirmAction(
  message: string,
  defaultNo: boolean = true,
): Promise<boolean> {
  const rl = createInterface({
    input: process.stdin,
    output: process.stdout,
  });

  const defaultText = defaultNo ? "y/N" : "Y/n";
  const answer = await new Promise<string>((resolve) => {
    rl.question(`${message} (${defaultText}): `, resolve);
  });
  rl.close();

  const normalizedAnswer = answer.toLowerCase().trim();
  if (defaultNo) {
    return normalizedAnswer === "y" || normalizedAnswer === "yes";
  } else {
    return normalizedAnswer !== "n" && normalizedAnswer !== "no";
  }
}
