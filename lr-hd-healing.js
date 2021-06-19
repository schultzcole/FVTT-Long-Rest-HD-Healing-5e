import HDLongRestDialog from "./new-long-rest.js";
import { libWrapper } from "./lib/libWrapper/shim.js";

Hooks.on("init", () => {
    game.settings.register("long-rest-hd-healing", "recovery-mult-hitpoints", {
        name: "Hit Points Recovery Fraction",
        hint: "The fraction missing hit points to recover on a long rest.",
        scope: "world",
        config: true,
        type: String,
        choices: {
            none: "None (default)",
            quarter: "Quarter",
            half: "Half",
            full: "Full",
        },
        default: "none",
    });

    game.settings.register("long-rest-hd-healing", "recovery-mult", {
        name: "Hit Dice Recovery Fraction",
        hint: "The fraction of hit dice to recover on a long rest.",
        scope: "world",
        config: true,
        type: String,
        choices: {
            none: "None",
            quarter: "Quarter",
            half: "Half (default)",
            full: "Full",
        },
        default: "half",
    });

    game.settings.register("long-rest-hd-healing", "recovery-rounding", {
        name: "Hit Dice Recovery Rounding",
        hint: "How to round the number of hit dice recovered.",
        scope: "world",
        config: true,
        type: String,
        choices: {
            down: "Round down (default)",
            up: "Round up",
        },
        default: "down",
    });

    game.settings.register("long-rest-hd-healing", "recovery-mult-resources", {
        name: "Resources Recovery Fraction",
        hint: "The fraction of resources to recover on a long rest.",
        scope: "world",
        config: true,
        type: String,
        choices: {
            none: "None",
            quarter: "Quarter",
            half: "Half",
            full: "Full (default)",
        },
        default: "full",
    });

    game.settings.register("long-rest-hd-healing", "recovery-mult-spells", {
        name: "Spell Slots Recovery Fraction",
        hint: "The fraction of spell slots to recover on a long rest (pact slots excluded).",
        scope: "world",
        config: true,
        type: String,
        choices: {
            none: "None",
            quarter: "Quarter",
            half: "Half",
            full: "Full (default)",
        },
        default: "full",
    });

    game.settings.register("long-rest-hd-healing", "recovery-mult-uses-feats", {
        name: "Feat uses Recovery Fraction",
        hint: "The fraction of feats uses to recover on a long rest.",
        scope: "world",
        config: true,
        type: String,
        choices: {
            none: "None",
            quarter: "Quarter",
            half: "Half",
            full: "Full (default)",
        },
        default: "full",
    });

    game.settings.register("long-rest-hd-healing", "recovery-mult-uses-others", {
        name: "Uses Recovery Fraction",
        hint: "The fraction of other uses (items, consumables, etc.) to recover on a long rest.",
        scope: "world",
        config: true,
        type: String,
        choices: {
            none: "None",
            quarter: "Quarter",
            half: "Half",
            full: "Full (default)",
        },
        default: "full",
    });

    game.settings.register("long-rest-hd-healing", "recovery-mult-day", {
        name: "Daily uses Recovery Fraction",
        hint: "The fraction of daily uses to recover on a long rest (items with the \"Day\" recovery setting).",
        scope: "world",
        config: true,
        type: String,
        choices: {
            none: "None",
            quarter: "Quarter",
            half: "Half",
            full: "Full (default)",
        },
        default: "full",
    });

    patch_newLongRest();
    patch_getRestHitPointRecovery();
    patch_getRestHitDiceRecovery();
    patch_getRestResourceRecovery();
    patch_getRestSpellRecovery();
    patch_getRestItemUsesRecovery();
});

function patch_newLongRest() {
    libWrapper.register(
        "long-rest-hd-healing",
        "CONFIG.Actor.entityClass.prototype.longRest",
        async function patchedLongRest(...args) {
            let { chat=true, dialog=true, newDay=true } = args[0] ?? {};

            const hd0 = this.data.data.attributes.hd;
            const hp0 = this.data.data.attributes.hp.value;

            // Before spending hit dice, recover a fraction of missing hit points (if applicable)
            const hitPointsRecoveryMultSetting = game.settings.get("long-rest-hd-healing", "recovery-mult-hitpoints");
            const hitPointsRecoveryMultiplier = determineLongRestMultiplier(hitPointsRecoveryMultSetting);

            if (hitPointsRecoveryMultiplier) {
                const maxHP = this.data.data.attributes.hp.max;
                const recoveredHP = Math.floor((maxHP - hp0) * hitPointsRecoveryMultiplier);

                await this.update({ "data.attributes.hp.value": hp0 + recoveredHP });
            }

            // Maybe present a confirmation dialog
            if (dialog) {
                try {
                    newDay = await HDLongRestDialog.hdLongRestDialog({ actor: this });
                } catch (err) {
                    return;
                }
            }

            const dhd = this.data.data.attributes.hd - hd0;
            const dhp = this.data.data.attributes.hp.value - hp0;
            return this._rest(chat, newDay, true, dhd, dhp);
        },
        "OVERRIDE",
    );
}

function patch_getRestHitPointRecovery() {
    libWrapper.register(
        "long-rest-hd-healing",
        "CONFIG.Actor.entityClass.prototype._getRestHitPointRecovery",
        function patched_getRestHitPointRecovery(wrapped, ...args) {
            const currentHP = this.data.data.attributes.hp.value;
            const result = wrapped(...args);

            // Undo changes to hp from wrapped function
            result.updates["data.attributes.hp.value"] = currentHP;
            result.hitPointsRecovered = 0;
            return result;
        },
        "WRAPPER",
    );
}

function patch_getRestHitDiceRecovery() {
    libWrapper.register(
        "long-rest-hd-healing",
        "CONFIG.Actor.entityClass.prototype._getRestHitDiceRecovery",
        function patched_getRestHitDiceRecovery(wrapped, ...args) {
            const { maxHitDice=undefined } = args[0] ?? {};

            const recoveryHDMultSetting = game.settings.get("long-rest-hd-healing", "recovery-mult");
            const recoveryHDMultiplier = determineLongRestMultiplier(recoveryHDMultSetting);

            if (recoveryHDMultiplier === 0) return { updates: [], hitDiceRecovered: 0 };

            const recoveryHDRoundSetting = game.settings.get("long-rest-hd-healing", "recovery-rounding");
            const recoveryHDRoundingFn = recoveryHDRoundSetting === "down" ? Math.floor : Math.ceil;

            const totalHitDice = this.data.data.details.level;
            const hitDiceToRecover = Math.clamped(recoveryHDRoundingFn(totalHitDice * recoveryHDMultiplier), 1, maxHitDice ?? totalHitDice);
            return wrapped({ maxHitDice: hitDiceToRecover });
        },
        "MIXED",
    );
}

function patch_getRestResourceRecovery() {
    libWrapper.register(
        "long-rest-hd-healing",
        "CONFIG.Actor.entityClass.prototype._getRestResourceRecovery",
        function patched_getRestResourceRecovery(...args) {
            const { recoverShortRestResources=true, recoverLongRestResources=true } = args[0] ?? {};

            const resourcesRecoveryMultSetting = game.settings.get("long-rest-hd-healing", "recovery-mult-resources");
            const resourcesRecoveryMultiplier = determineLongRestMultiplier(resourcesRecoveryMultSetting);

            if (resourcesRecoveryMultiplier === 0) return {};

            let updates = {};
            for ( let [k, r] of Object.entries(this.data.data.resources) ) {
                if (Number.isNumeric(r.max)) {
                    if (recoverShortRestResources && r.sr) {
                        updates[`data.resources.${k}.value`] = Number(r.max);
                    } else if (recoverLongRestResources && r.lr) {
                        let recoverResources = Math.max(Math.floor(r.max * resourcesRecoveryMultiplier), 1);
                        updates[`data.resources.${k}.value`] = Math.min(r.value + recoverResources, r.max);
                    }
                }
            }
            return updates;
        },
        "OVERRIDE",
    );
}

function patch_getRestSpellRecovery() {
    libWrapper.register(
        "long-rest-hd-healing",
        "CONFIG.Actor.entityClass.prototype._getRestSpellRecovery",
        function patched_getRestSpellRecovery(wrapped, ...args) {
            const { recoverPact=true, recoverSpells=true } = args[0] ?? {};

            const spellsRecoveryMultSetting = game.settings.get("long-rest-hd-healing", "recovery-mult-spells");
            const spellsRecoveryMultiplier = determineLongRestMultiplier(spellsRecoveryMultSetting);

            // Defer to the original method for recovering pact slots
            const results = wrapped({ recoverPact, recoverSpells: false });

            if (!recoverSpells || spellsRecoveryMultiplier === 0) return results;

            // But overwrite the logic for recovering other spell slots
            for ( let [k, v] of Object.entries(this.data.data.spells) ) {
                if (!v.override && !v.max) continue;
                let spellMax = v.override || v.max;
                let recoverSpells = Math.max(Math.floor(spellMax * spellsRecoveryMultiplier), 1);
                results[`data.spells.${k}.value`] = Math.min(v.value + recoverSpells, spellMax);
            }

            return results;
        },
        "WRAPPER",
    );
}

function patch_getRestItemUsesRecovery() {
    libWrapper.register(
        "long-rest-hd-healing",
        "CONFIG.Actor.entityClass.prototype._getRestItemUsesRecovery",
        function patched_getRestItemUsesRecovery(wrapped, ...args) {
            const { recoverShortRestUses=true, recoverLongRestUses=true, recoverDailyUses=true } = args[0] ?? {};

            const featsUsesRecoveryMultSetting = game.settings.get("long-rest-hd-healing", "recovery-mult-uses-feats");
            const featsUsesRecoveryMultiplier = determineLongRestMultiplier(featsUsesRecoveryMultSetting);
            const othersUsesRecoveryMultSetting = game.settings.get("long-rest-hd-healing", "recovery-mult-uses-others");
            const othersUsesRecoveryMultiplier = determineLongRestMultiplier(othersUsesRecoveryMultSetting);
            const dayRecoveryMultSetting = game.settings.get("long-rest-hd-healing", "recovery-mult-day");
            const dayRecoveryMultiplier = determineLongRestMultiplier(dayRecoveryMultSetting);

            const results = wrapped({ recoverShortRestUses, recoverLongRestUses: false, recoverDailyUses: false });

            for ( let item of this.items ) {
                const d = item.data.data;
                if (d.uses) {
                    switch (d.uses.per) {
                        case "lr":
                            if(item.type === 'feat') {
                                if (!recoverLongRestUses || featsUsesRecoveryMultiplier === 0) break;
                                let recoverUses = Math.max(Math.floor(d.uses.max * featsUsesRecoveryMultiplier), 1);
                                results.push({ _id: item.id, "data.uses.value": Math.min(d.uses.value + recoverUses, d.uses.max) });
                            } else {
                                if (!recoverLongRestUses || othersUsesRecoveryMultiplier === 0) break;
                                let recoverUses = Math.max(Math.floor(d.uses.max * othersUsesRecoveryMultiplier), 1);
                                results.push({ _id: item.id, "data.uses.value": Math.min(d.uses.value + recoverUses, d.uses.max) });
                            }
                            break;
                        case "day":
                            if (!recoverDailyUses || dayRecoveryMultiplier === 0) break;
                            let recoverDay = Math.max(Math.floor(d.uses.max * dayRecoveryMultiplier), 1);
                            results.push({ _id: item.id, "data.uses.value": Math.min(d.uses.value + recoverDay, d.uses.max) });
                            break;
                    }
                } else if (recoverLongRestUses && d.recharge && d.recharge.value) {
                    results.push({_id: item.id, "data.recharge.charged": true});
                }
            }

            return results;
        },
        "WRAPPER",
    );
}

// Recover the multiplier based on setting
function determineLongRestMultiplier(multSetting) {
    let recoveryMultiplier = 1;

    switch (multSetting) {
        case "none":
            recoveryMultiplier = 0;
            break;
        case "quarter":
            recoveryMultiplier = 0.25;
            break;
        case "half":
            recoveryMultiplier = 0.5;
            break;
        case "full":
            recoveryMultiplier = 1.0;
            break;
        default:
            throw new Error(`Unable to parse recovery multiplier setting, got "${multSetting}".`);
    }

    return recoveryMultiplier;
}
