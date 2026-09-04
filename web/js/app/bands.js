/*
 *  NanoVNA-WebSaver
 *
 *  Copyright (C) 2019, 2020  Rune B. Broberg
 *  Copyright (C) 2020ff NanoVNA-Saver Authors
 *
 *  This program is free software: you can redistribute it and/or modify
 *  it under the terms of the GNU General Public License as published by
 *  the Free Software Foundation, either version 3 of the License, or
 *  (at your option) any later version.
 *
 *  This program is distributed in the hope that it will be useful,
 *  but WITHOUT ANY WARRANTY; without even the implied warranty of
 *  MERCHANTABILITY or FITNESS FOR A PARTICULAR PURPOSE.  See the
 *  GNU General Public License for more details.
 *
 *  You should have received a copy of the GNU General Public License
 *  along with this program.  If not, see <https://www.gnu.org/licenses/>.
 */

// The amateur band plans drawn as reference bands on the charts, taken
// from NanoVNASaver/Settings/Bands.py.

export const BAND_REGIONS = {
  'IARU Region 1': [
    { name: '2200 m', start: 135700, end: 137800 },
    { name: '630 m', start: 472000, end: 479000 },
    { name: '160 m', start: 1800000, end: 2000000 },
    { name: '80 m', start: 3500000, end: 3800000 },
    { name: '60 m', start: 5250000, end: 5450000 },
    { name: '40 m', start: 7000000, end: 7200000 },
    { name: '30 m', start: 10100000, end: 10150000 },
    { name: '20 m', start: 14000000, end: 14350000 },
    { name: '17 m', start: 18068000, end: 18168000 },
    { name: '15 m', start: 21000000, end: 21450000 },
    { name: '12 m', start: 24890000, end: 24990000 },
    { name: '10 m', start: 28000000, end: 29700000 },
    { name: '6 m', start: 50000000, end: 52000000 },
    { name: '4 m', start: 69887500, end: 70512500 },
    { name: '2 m', start: 144000000, end: 146000000 },
    { name: '70 cm', start: 430000000, end: 440000000 },
    { name: '23 cm', start: 1240000000, end: 1300000000 },
    { name: '13 cm', start: 2300000000, end: 2450000000 },
    { name: '5 cm', start: 5650000000, end: 5850000000 },
  ],
  'IARU Region 2': [
    { name: '2200 m', start: 135700, end: 137800 },
    { name: '630 m', start: 472000, end: 479000 },
    { name: '160 m', start: 1800000, end: 2000000 },
    { name: '80 m', start: 3500000, end: 4000000 },
    { name: '60 m', start: 5250000, end: 5450000 },
    { name: '40 m', start: 7000000, end: 7300000 },
    { name: '30 m', start: 10100000, end: 10150000 },
    { name: '20 m', start: 14000000, end: 14350000 },
    { name: '17 m', start: 18068000, end: 18168000 },
    { name: '15 m', start: 21000000, end: 21450000 },
    { name: '12 m', start: 24890000, end: 24990000 },
    { name: '10 m', start: 28000000, end: 29700000 },
    { name: '6 m', start: 50000000, end: 54000000 },
    { name: '4 m', start: 69887500, end: 70512500 },
    { name: '2 m', start: 144000000, end: 148000000 },
    { name: '1.25 m', start: 222000000, end: 225000000 },
    { name: '70 cm', start: 420000000, end: 450000000 },
    { name: '33 cm', start: 902000000, end: 928000000 },
    { name: '23 cm', start: 1240000000, end: 1300000000 },
    { name: '13 cm', start: 2300000000, end: 2450000000 },
    { name: '9 cm', start: 3300000000, end: 3500000000 },
    { name: '5 cm', start: 5650000000, end: 5925000000 },
  ],
  'IARU Region 3': [
    { name: '2200 m', start: 135700, end: 137800 },
    { name: '630 m', start: 472000, end: 479000 },
    { name: '160 m', start: 1800000, end: 2000000 },
    { name: '80 m', start: 3500000, end: 3900000 },
    { name: '60 m', start: 5250000, end: 5450000 },
    { name: '40 m', start: 7000000, end: 7200000 },
    { name: '30 m', start: 10100000, end: 10150000 },
    { name: '20 m', start: 14000000, end: 14350000 },
    { name: '17 m', start: 18068000, end: 18168000 },
    { name: '15 m', start: 21000000, end: 21450000 },
    { name: '12 m', start: 24890000, end: 24990000 },
    { name: '10 m', start: 28000000, end: 29700000 },
    { name: '6 m', start: 50000000, end: 54000000 },
    { name: '4 m', start: 69887500, end: 70512500 },
    { name: '2 m', start: 144000000, end: 148000000 },
    { name: '70 cm', start: 430000000, end: 440000000 },
    { name: '23 cm', start: 1240000000, end: 1300000000 },
    { name: '13 cm', start: 2300000000, end: 2450000000 },
    { name: '9 cm', start: 3300000000, end: 3500000000 },
    { name: '5 cm', start: 5650000000, end: 5850000000 },
  ],
};
export const DEFAULT_REGION = 'IARU Region 1';
export const DEFAULT_BANDS = BAND_REGIONS[DEFAULT_REGION];
