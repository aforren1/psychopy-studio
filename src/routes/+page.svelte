<script>
    import { electron, python } from "$lib/globals.svelte";
    import { newWindow } from "$lib/utils/views.svelte";
    import { Button } from "$lib/utils/buttons";
    import { Icon } from "$lib/utils/icons";
    import { asset } from "$app/paths";

    // handle initial setup
    let ready = $state({
        status: Promise.withResolvers(),
        message: "",
    });

    async function setup() {
        // abort if on browser
        if (!python) {
            return;
        }
        // do we already have UV and Python?
        ready.message = "Checking Python...";
        let hasUV = await python.uv
            .exists()
            .catch((err) => ready.status.reject(err));
        let hasPython = await python.uv
            .findPython()
            .catch((err) => ready.status.reject(err));
        // install UV
        if (!hasUV) {
            ready.message = "Downloading UV (a Python installer)...";
            await python.uv
                .installUV()
                .catch((err) => ready.status.reject(err));
        }
        // install Python
        if (!hasPython) {
            ready.message = "Installing Python...";
            await python.uv
                .installPython()
                .catch((err) => ready.status.reject(err));
        }
        // start python
        ready.message = "Starting Python...";
        await python.start().catch((err) => ready.status.reject(err));

        // Wait for background services to complete
        ready.message = "Initializing services...";
        await new Promise((resolve) => setTimeout(resolve, 2000));

        // activatePlugins
        ready.message = "Activating plugins...";
        await python.liaison
            .send(
                {
                    command: "run",
                    args: ["psychopy.plugins:activatePlugins"],
                },
                20000,
            )
            .catch((err) => ready.status.reject(err));
        // mark success
        ready.status.resolve();
    }
    setup();
</script>

<div class="container">
    <svg class="background">
        <use href={asset("/branding/component-wave.svg")}></use>
    </svg>
    <nav>
        <button
            class="view"
            aria-label="builder"
            onclick={(evt) => newWindow("builder")}
        >
            <h3>Builder</h3>
            <Icon src="/icons/btn-builder.svg" size="10rem" ; />
            <p>
                Generate experiments easily using an intuitive graphical user
                interface (GUI).
            </p>
        </button>
        <button
            class="view"
            aria-label="coder"
            onclick={(evt) => newWindow("coder")}
        >
            <h3>Coder</h3>
            <Icon src="/icons/btn-coder.svg" size="10rem" ; />
            <p>Write and edit code directly in a variety of languages.</p>
        </button>
        {#if electron}
            <button
                class="view"
                aria-label="runner"
                onclick={(evt) => newWindow("runner")}
            >
                <h3>Runner</h3>
                <Icon src="/icons/btn-runner.svg" size="10rem" ; />
                <p>
                    Coordinate running experiments and scripts and view any
                    warnings generated.
                </p>
            </button>
        {/if}
    </nav>
    <div class="message">
        {#await ready.status.promise}
            {ready.message}
        {:then}
            Ready
        {:catch err}
            Failed setup: {err}
            <Button
                label="Try again?"
                icon="/icons/btn-refresh.svg"
                onclick={(evt) => setup()}
                horizontal
            />
        {/await}
    </div>
</div>

<style>
    .container {
        position: fixed;
        left: 0;
        right: 0;
        top: 0;
        bottom: 0;
        display: flex;
        flex-direction: column;
        gap: 1rem;
        padding: 4rem;
        align-items: center;
        justify-content: center;
        background-color: var(--mantle);
    }

    .message {
        display: flex;
        flex-direction: column;
        gap: 0.5rem;
        align-items: center;
    }
    .background {
        position: absolute;
        width: 120%;
        min-width: 1080px;
        z-index: -1;
        object-fit: contain;
        opacity: 50%;
    }
    nav {
        position: relative;
        display: flex;
        flex-direction: row;
        gap: 2rem;
        margin: auto;
        z-index: 1;
    }
    .view {
        display: flex;
        flex-direction: column;
        align-items: center;
        gap: 0.5rem;

        width: 15rem;
        padding: 1rem;
        border: 1px solid var(--overlay);
        border-radius: 1rem;
        background-color: var(--base);
    }

    button:enabled:hover,
    button:enabled:focus {
        outline: none;
        border-color: var(--blue);
        box-shadow: inset 1px 1px 10px rgba(0, 0, 0, 0.05);
    }

    button:disabled {
        background-color: var(--crust);
        color: var(--outline);
    }
</style>
