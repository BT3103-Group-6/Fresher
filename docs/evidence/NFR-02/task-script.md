# NFR-02 usability test: task script

Requirement (NFR-02): 95% of representative first-time users complete the standard booking flow without help. Before final confirmation, one screen shows shop, service, barber, date, time and price. Every invalid or missing required input shows a visible message naming the field. A successful booking shows an explicit confirmation with the appointment details.

Moderator: Firas. Results go in [results.md](results.md); consent in [consent-form.md](consent-form.md).

---

## 1. Setup

Sessions run on the moderator's laptop against the Firebase emulators. Nothing touches the live project, and no real SMS is sent.

**Branch.** `scripts/seed.mjs` is not on `main` yet (PR-13 not merged), so the sessions run from **`chore/demo-dataset`**. Record the branch and commit in results.md (`git branch --show-current`, `git log --oneline -1`).

### Once at the start of each session day

1. **Fresh emulators.** Stop the emulators, then start them again (`firebase emulators:start`).
2. **Seed.** Run `npm run seed` and wait for "Validation passed".
3. **App.** Run `npm run dev` and open the printed local URL in Chrome.

### Before each participant

1. **Phone-sized window.** Open DevTools, turn on device mode, and choose a 390 × 844 phone size (for example iPhone 12 Pro). Dock or close the DevTools panel so it does not cover the page. Zoom 100%.
2. **Start screen.** Open a fresh incognito window (so no one is signed in), load the landing page (`/`) and switch device mode on again.
3. **Test number.** Each participant has their own test number, so no one sees another participant's booking in My bookings:

   | Participant | Test number | Type as |
   |---|---|---|
   | P01 | +65 9000 0001 | 9000 0001 |
   | P02 | +65 9000 0002 | 9000 0002 |
   | P03 | +65 9000 0003 | 9000 0003 |
   | P04 | +65 9000 0004 | 9000 0004 |
   | P05 | +65 9000 0005 | 9000 0005 |
   | P06 | +65 9000 0006 | 9000 0006 |
   | P07 | +65 9000 0007 | 9000 0007 |
   | P08 | +65 9000 0008 | 9000 0008 |

   The Auth emulator accepts any number and prints the code in its terminal. Write the participant's number on a card to hand them.
4. **Emulator terminal.** Keep the terminal running the emulators visible to the moderator only. The Auth emulator prints each OTP code there; check that the number next to the code is this participant's.
5. **Stopwatch and sheet.** Have a stopwatch and the results table ready, with the participant ID filled in.

### The OTP is part of the setup, not help

The app sends a 6-digit code by SMS. In the emulator no SMS is sent; the code appears in the emulator terminal. **When the participant reaches the code field, the moderator reads the code out.** This stands in for the participant's phone receiving an SMS, so it is part of the setup and **does not count as help**. Read only the six digits ("4 1 7 2 0 3"); say nothing about where to type it or what to press next.

---

## 2. Intro (read to each participant)

> Thank you for taking part. We are testing an app called Fresher, which lets you book a haircut at a barbershop near you. We are testing the app, not you, so there are no wrong answers. If something is confusing, that is useful for us to know.
>
> I will give you three short tasks, one at a time. Please try to do each one on your own, as if I were not here. You can think out loud if you like. I will not be able to help while you work, but if you are stuck you can say so, or tell me you want to stop the task. You can stop the whole session at any time.
>
> The app is running on a test system. When it asks for your name, please use a made-up name. When it asks for a phone number, please use this test number, not your own. *(Hand over the card with the participant's test number, for example 9000 0003 for P03.)* When the app sends a code by SMS, I will read the code out to you, because no real SMS is sent.
>
> Do you have any questions before we start?

---

## 3. Tasks

Read each task aloud, then hand the laptop over. Start the stopwatch when you finish reading. Stop it when the success criterion is met, or when the participant gives up or asks for help they need in order to continue.

### Task 1: find a barbershop

> "You live near postal code 1 6 0 0 5 5. Find a barbershop near you that you would like to book."

- **Success:** the participant searches with postal code 160055 (or uses a quick pick that does the same) and opens the page of any shop in the results.
- **Counts as help:** any hint about where to tap or what to type, for example pointing at the search box, saying "try the Search button", or repeating the postal code digit by digit after they have started typing a different one. Re-reading the task as written once, if asked, is not help.
- **Note:**
  - time taken;
  - errors (for example a wrong postal code, and whether the error message named the field and was understood);
  - which shop they chose, and whether they used the distance, price and "Next available" details.

### Task 2: book a slot

> "Book any haircut at that shop, at least two days from today, at a time that suits you. Use a made-up name and the phone number on your card."

("At least two days from today" keeps the booking outside every shop's cancellation window, so task 3 is never blocked: the longest notice window in the seeded shops is 24 hours. If the participant picks today or tomorrow, note it, but do not correct them; if task 3 is then blocked by the window, note that the block came from the slot choice, not from the participant.)

- **Success:** the participant reaches the **Booking confirmed** screen. A booking less than two days ahead still counts as success for task 2.
- **Counts as help:** any hint about where to tap or what to type, for example "choose a service first", "scroll down for the times", "press Send code" or "type the code here". Reading the OTP code out is **not** help (see setup).
- **Note:**
  - time taken;
  - errors (for example Continue without a service or time, an invalid phone number, a wrong code) and whether each message named the field and was understood;
  - **summary screen:** before pressing Confirm booking, did they look at the "Your booking" summary (shop, service, barber, date, time, price)? Ask afterwards: "Before you confirmed, what were you booking?" Note whether their answer matched;
  - **confirmation:** on the Booking confirmed screen, ask: "When is your appointment, and with whom?" Note whether they could answer from the screen and whether anything was unclear;
  - whether they chose a specific barber or "Any available barber".

### Task 3: cancel or reschedule

> "Something has come up. Go to My bookings and either cancel this booking or move it to another time. Your choice."

- **Success:** the booking shows as cancelled, or shows the new time, in My bookings.
- **Counts as help:** any hint about where to tap or what to type, for example pointing at "Manage my bookings" or the My bookings link, or saying which button cancels or moves the booking. Reading the new OTP code out is **not** help (My bookings asks for a fresh code first).
- **Note:**
  - time taken;
  - which they chose (cancel or reschedule);
  - errors, and whether the messages were understood;
  - whether the cancellation policy text was read and understood;
  - for a reschedule, whether the new time was clear afterwards.

---

## 4. After the tasks

Ask, and note the answers in a few words:
1. "Was anything confusing or slower than you expected?"
2. "Was there anything you expected to see but did not?"
3. "Have you used Fresher before today?" (only first-time users count towards the NFR-02 rate; see results.md)

Thank the participant. Do not show them the notes.

---

## 5. Moderator rules

- Do not lead. If asked "Is this right?", answer "What would you do if I were not here?"
- If a participant is stuck for more than 2 minutes, ask "Would you like to stop this task?" If they say yes, mark the task "no", note where they were stuck, and move on. If the next task depends on it (task 3 needs a booking), you may complete the step for them; that task then still starts from a fair state, but note it.
- Note any help given, word for word, even if small.
- If the app errors (not the participant), note the message and the time, and mark the session as affected by a defect.
