import { mount } from 'svelte';

import '../../../../src/tailwind.css';

import Harness from './Harness.svelte';

mount(Harness, { target: document.getElementById('app')! });
