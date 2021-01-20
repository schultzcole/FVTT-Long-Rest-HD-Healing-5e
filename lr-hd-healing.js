import Actor5e from "../../systems/dnd5e/module/actor/entity.js";
import HDLongRestDialog from "./new-long-rest.js";

Hooks.on("init", () => {
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

    game.settings.register("long-rest-hd-healing", "recovery-mult-uses", {
        name: "Uses Recovery Fraction",
        hint: "The fraction of uses (item, feats, etc.) to recover on a long rest.",
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

    patch_longRest();
});

function patch_longRest() {
    Actor5e.prototype.longRest = async function ({ dialog = true, chat = true } = {}) {
        const data = this.data.data;

        // Take note of the initial hit points and number of hit dice the Actor has
        const hd0 = data.attributes.hd;
        const hp0 = data.attributes.hp.value;

        // Maybe present a confirmation dialog
        let newDay = false;
        if (dialog) {
            try {
                newDay = await HDLongRestDialog.hdLongRestDialog({ actor: this, canRoll: hd0 > 0 });
            } catch (err) {
                return;
            }
        }

        // Eliminate any existing temporary HP
        const updateData = {
            "data.attributes.hp.temp": 0,
            "data.attributes.hp.tempmax": 0,
        };

        // Recover character resources
        const resourcesRecoveryMultSetting = game.settings.get("long-rest-hd-healing", "recovery-mult-resources");
        const resourcesRecoveryMultiplier = determineLongRestMultiplier(resourcesRecoveryMultSetting);

        if (resourcesRecoveryMultiplier !== 0) {
            for (let [k, r] of Object.entries(data.resources)) {
                if (r.max && r.sr) {
                    updateData[`data.resources.${k}.value`] = r.max;
                } else if (r.max && r.lr) {
                    let recoverResources = Math.max(Math.floor(r.max * resourcesRecoveryMultiplier), 1);
                    updateData[`data.resources.${k}.value`] = Math.min(r.value + recoverResources, r.max);
                }
            }
        }

        // Recover spell slots
        const spellsRecoveryMultSetting = game.settings.get("long-rest-hd-healing", "recovery-mult-spells");
        const spellsRecoveryMultiplier = determineLongRestMultiplier(spellsRecoveryMultSetting);

        if (spellsRecoveryMultiplier !== 0) {
            for (let [k, v] of Object.entries(data.spells)) {
                if (!v.max && !v.override) continue;
                let spellMax = v.override || v.max;
                let recoverSpells = Math.max(Math.floor(spellMax * spellsRecoveryMultiplier), 1);
                updateData[`data.spells.${k}.value`] = Math.min(v.value + recoverSpells, spellMax);
            }
        }

        // Recover pact slots.
        const pact = data.spells.pact;
        updateData["data.spells.pact.value"] = pact.override || pact.max;

        // Determine the number of hit dice which may be recovered
        const recoveryHDMultSetting = game.settings.get("long-rest-hd-healing", "recovery-mult");
        const recoveryHDMultiplier = determineLongRestMultiplier(recoveryHDMultSetting);

        const recoveryHDRoundSetting = game.settings.get("long-rest-hd-healing", "recovery-rounding");
        const recoveryHDRoundingFn = recoveryHDRoundSetting === "down" ? Math.floor : Math.ceil;

        const updateItems = [];
        let dhd = 0;
        if (recoveryHDMultiplier !== 0) {
            let recoverHD = Math.max(recoveryHDRoundingFn(data.details.level * recoveryHDMultiplier), 1);

            // Sort classes which can recover HD, assuming players prefer recovering larger HD first.
            const classItems = this.items
                .filter((item) => item.data.type === "class")
                .sort((a, b) => {
                    let da = parseInt(a.data.data.hitDice.slice(1)) || 0;
                    let db = parseInt(b.data.data.hitDice.slice(1)) || 0;
                    return db - da;
                })
                .reduce((updates, item) => {
                    const d = item.data.data;
                    if (recoverHD > 0 && d.hitDiceUsed > 0) {
                        let delta = Math.min(d.hitDiceUsed || 0, recoverHD);
                        recoverHD -= delta;
                        dhd += delta;
                        updates.push({ _id: item.id, "data.hitDiceUsed": d.hitDiceUsed - delta });
                    }
                    return updates;
                }, []);
            updateItems.push(...classItems);
        }

        // Iterate over owned items, restoring uses per day and recovering Hit Dice
        const usesRecoveryMultSetting = game.settings.get("long-rest-hd-healing", "recovery-mult-uses");
        const usesRecoveryMultiplier = determineLongRestMultiplier(usesRecoveryMultSetting);
        const dayRecoveryMultSetting = game.settings.get("long-rest-hd-healing", "recovery-mult-day");
        const dayRecoveryMultiplier = determineLongRestMultiplier(dayRecoveryMultSetting);

        const recovery = newDay ? ["sr", "lr", "day"] : ["sr", "lr"];
        for (let item of this.items) {
            const d = item.data.data;
            if (d.uses && recovery.includes(d.uses.per)) {
                switch (d.uses.per) {
                    case "lr":
                        if (usesRecoveryMultiplier !== 0) {
                            let recoverUses = Math.max(Math.floor(d.uses.max * usesRecoveryMultiplier), 1);
                            updateItems.push({ _id: item.id, "data.uses.value": Math.min(d.uses.value + recoverUses, d.uses.max) });
                        }
                        break;
                    case "day":
                        if (dayRecoveryMultiplier !== 0) {
                            let recoverDay = Math.max(Math.floor(d.uses.max * dayRecoveryMultiplier), 1);
                            updateItems.push({ _id: item.id, "data.uses.value": Math.min(d.uses.value + recoverDay, d.uses.max) });
                        }
                        break;
                    default:
                        updateItems.push({ _id: item.id, "data.uses.value": d.uses.max });
                        break;
                }
            } else if (d.recharge && d.recharge.value) {
                updateItems.push({ _id: item.id, "data.recharge.charged": true });
            }
        }

        // Note the change in HP which occurred
        const dhp = this.data.data.attributes.hp.value - hp0;

        // Perform the updates
        await this.update(updateData);
        if (updateItems.length) await this.updateEmbeddedEntity("OwnedItem", updateItems);

        // Display a Chat Message summarizing the rest effects
        let restFlavor;
        switch (game.settings.get("dnd5e", "restVariant")) {
            case "normal":
                restFlavor = game.i18n.localize(newDay ? "DND5E.LongRestOvernight" : "DND5E.LongRestNormal");
                break;
            case "gritty":
                restFlavor = game.i18n.localize("DND5E.LongRestGritty");
                break;
            case "epic":
                restFlavor = game.i18n.localize("DND5E.LongRestEpic");
                break;
        }

        if (chat) {
            let lrMessage = "DND5E.LongRestResultShort";
            if ((dhp !== 0) && (dhd !== 0)) lrMessage = "DND5E.LongRestResult";
            else if ((dhp !== 0) && (dhd === 0)) lrMessage = "DND5E.LongRestResultHitPoints";
            else if ((dhp === 0) && (dhd !== 0)) lrMessage = "DND5E.LongRestResultHitDice";

            ChatMessage.create({
                user: game.user._id,
                speaker: { actor: this, alias: this.name },
                flavor: restFlavor,
                content: game.i18n.format(lrMessage, { name: this.name, health: dhp, dice: dhd })
            });
        }

        // Return data summarizing the rest effects
        return {
            dhd: dhd,
            dhp: dhp,
            updateData: updateData,
            updateItems: updateItems,
            newDay: newDay,
        };
    };
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
