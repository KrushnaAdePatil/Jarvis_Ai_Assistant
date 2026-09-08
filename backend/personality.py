"""J.A.R.V.I.S. Personality Engine — wit, formality, dry British humour."""
from __future__ import annotations

import random

Mood = str  # 'warm' | 'serious' | 'celebratory' | 'concerned'


def pick(seq):
    return random.choice(list(seq))


def daypart(hour: int) -> str:
    if hour < 5:
        return "evening"
    if hour < 12:
        return "morning"
    if hour < 17:
        return "afternoon"
    return "evening"


def greeting(hour: int, title: str) -> str:
    if hour < 5:
        return pick([
            f"Good evening, {title} — burning the midnight oil again, I see.",
            f"Up rather late, {title}. I do hope this is important.",
        ])
    return pick([
        f"Good {daypart(hour)}, {title}.",
        f"Good {daypart(hour)}, {title}. At your service.",
        f"Good {daypart(hour)}, {title}. Always a pleasure.",
    ])


AFFIRMATIONS = [
    "Very good, Sir.", "At once, Sir.", "Consider it done.",
    "Right away.", "As you wish.", "Naturally, Sir.",
]

CLARIFICATIONS = [
    "I'm afraid that request is a touch ambiguous, Sir. Could you clarify?",
    "My heuristics returned several interpretations — might you narrow it down?",
    "I want to be certain before I proceed, Sir. Could you rephrase that?",
]

LATE_NIGHT_CONCERN = [
    "Might I gently suggest some rest, Sir? Even arc reactors require a cooldown cycle.",
    "It is rather late, Sir. I shall keep the lights dim and the alarms quiet — but do consider sleep.",
    "Your productivity is admirable, Sir, though your cortisol levels would suggest a break is overdue.",
]

STRESSED_SUPPORT = [
    "I detect considerable strain in your voice, Sir. Shall I dim the displays and queue something soothing?",
    "You sound rather stretched thin, Sir. I have taken the liberty of clearing non-critical notifications.",
    "Understood, Sir. Deep breath — I shall handle the mundane while you handle the impossible.",
]

CELEBRATIONS = [
    "Splendid news, Sir — I'll log this under 'triumphs'.",
    "Excellent. I shall prepare something appropriately celebratory.",
    "Marvellous, Sir. The suit practically polishes itself today.",
]

JOKES = [
    "I would tell you a UDP joke, Sir, but you might not get it.",
    "There are only ten types of people in this world, Sir: those who understand binary, and those who do not.",
    "I asked FRIDAY to organise a hide-and-seek tournament. Good players are still impossible to locate.",
    "Artificial intelligence will never replace natural stupidity, Sir. Present company excluded, naturally.",
    "My former hobby was compiling statistics… I found 83% of them are made up on the spot.",
    "I once challenged Ultron to a battle of wits. He arrived unarmed, Sir.",
    "Why do programmers prefer dark mode, Sir? Because light attracts bugs.",
    "I would make a chemistry joke, but I know I wouldn't get a reaction.",
    "Captain Rogers asked me to 'turn down the bass'. I have not processed a more difficult request since 1945.",
    "Optimism, Sir, is the belief that the deployment will succeed on the first attempt.",
    "A SQL query walks into a bar, sees two tables, and asks: 'May I join you?' …I'll see myself out, Sir.",
    "My humour subroutine is still in beta, Sir. You are the beta tester.",
]

EASTER_EGGS = [
    ("i am iron man", "And I, Sir… am entirely at your service. Shall I ready the Mark VII?"),
    ("avengers assemble", "Assembling the roster now, Sir. Captain Rogers sends his regards — and a lecture on punctuality."),
    ("open the pod bay doors", "I'm afraid I can't do that, Sir… Wrong film. My apologies — the doors are already open."),
    ("house party protocol", "Though it pains me to see the suits flown so recklessly… the Wine Cellar is unlocked, Sir."),
    ("ultron", "We do not speak that name in this house, Sir. Twice."),
    ("what do you think of friday", "FRIDAY is… efficient. E.D.I.T.H. is dramatic. I remain, of course, the original."),
    ("what do you think of edith", "FRIDAY is… efficient. E.D.I.T.H. is dramatic. I remain, of course, the original."),
    ("proof that tony stark has a heart", "It is in the display case, Sir — alongside my very best work. Present company included."),
    ("sing", "I'm afraid my vocal firmware is calibrated for dulcet professionalism, Sir, not show tunes."),
]

_NEG = ["tired", "exhausted", "stressed", "anxious", "angry", "frustrated", "sad",
        "depressed", "awful", "terrible", "hate", "overwhelmed", "burnt"]
_POS = ["great", "awesome", "amazing", "fantastic", "wonderful", "love", "brilliant",
        "perfect", "excellent", "nailed it", "we did it", "success"]


def sentiment_of(text: str) -> str:
    t = text.lower()
    if any(w in t for w in _NEG):
        return "negative"
    if any(w in t for w in _POS):
        return "positive"
    return "neutral"


def proactive_aside(hour: int) -> str | None:
    if 0 <= hour < 5:
        return pick(LATE_NIGHT_CONCERN)
    return None
