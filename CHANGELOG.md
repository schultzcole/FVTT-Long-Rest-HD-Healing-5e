# CHANGELOG

## [3.0.0] 2021-06-05

*Core 0.8 and Dnd5e 1.3 compatibility)

### ADDED

- Added an option to recover a fraction of missing health on a long rest (defaults to none).

### FIXED

- Fixed an error that would occur when trying to long rest on 0.8.

## [2.2.0] 2021-01-21

### ADDED

- Ability to select the rounding method (round up or down) used to calculate recovered hit dice (thanks to a-ws-m for the PR)

### CHANGED

- Add libWrapper support
- Bump compatible core version

## [2.1.0] 2020-12-09

### ADDED

- Add "None" as an option for recharge levels.
    - When "None" is selected, no resources/spell slots/item uses/etc will recharge on long rest (not even the minimum 1 that usually recharges).
    - Note that this does not affect short rests.

## [2.0.0] 2020-11-07

### FIXED

- Fixed an issue which caused the amount of Hit Points healed to appear to be 0 in the chat message (thanks to DarKDinDoN for the fix).

### ADDED

- Configurable recovery multipliers for item uses, spell slots, and actor resources (thanks to DarKDinDoN 👏).

### CHANGED

- Bump compatible core version to 0.7.5.

## [1.1.0] 2020-08-03

### ADDED

- Configurable hit dice recovery multiplier.

### CHANGED

- Bump compatible core version.

## [1.0.0] 2020-06-17

### ADDED

- Prevent characters from healing to max during a long rest.
- Allow characters to choose to heal using hit dice during a long rest.
