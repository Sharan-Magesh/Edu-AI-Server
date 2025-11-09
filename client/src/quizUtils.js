export function evaluateAnswer(question, userAnswer) {
  if (question.type === "mcq") {
    return userAnswer.trim().toUpperCase() === question.answer.toUpperCase();
  }
  if (question.type === "short") {
    return userAnswer.trim().toLowerCase() === question.answer.toLowerCase();
  }
  if (question.type === "explain") {
    const text = userAnswer.toLowerCase();
    return question.rubric.some((k) => text.includes(k.toLowerCase()));
  }
  return false;
}
